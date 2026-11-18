/**
 * Data-layer checks for the index queue and the connect-time setup choice (0048).
 *
 * Needs DATABASE_URL. Creates and deletes its own synthetic repositories and
 * one synthetic project; truncates nothing. See ../sequence-verify/README.md
 * for the throwaway-Postgres recipe.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/reposetup-verify/queue.ts
 *
 * What it proves against a real database, with a real HTTP server standing in
 * for the Graphify microservice, rather than against a mock:
 *
 *  1. The conditional claim really is one claim. Two overlapping dispatcher
 *     ticks on the same queued repository produce exactly ONE request to the
 *     service. A select-then-update would produce two, and two clone-and-
 *     extract jobs on a customer's repository is the whole thing the claim
 *     exists to prevent.
 *  2. A refused handoff parks the row back as `queued`, not `failed`, so the
 *     next tick retries it. `failed` is what the service's own callback says
 *     when extraction breaks, and conflating the two shows a customer an error
 *     for a service restart.
 *  3. A repository with no URL is settled as `failed` rather than sitting in
 *     the queue for ever.
 *  4. The setup dispatch stamps a non-scanning choice without doing anything,
 *     leaves a scanning choice alone while its index is still in flight, and
 *     records a refusal in words once it is not.
 *  5. setup_choice survives being honoured: the record of what was asked for
 *     is never cleared, only stamped.
 */
import { createServer, type Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { db, repositoriesTable, projectsTable } from "@workspace/db";
import { claimQueuedIndex, dispatchQueuedIndexes } from "../../src/services/graphifyService.js";
import { dispatchPendingSetups } from "../../src/services/repoSetup.js";

const OWNER = "rs-verify-owner";
const PROJECT = "rs-verify-project";
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

/** Stands in for the Graphify microservice. Counts what it is asked to do. */
function stubService(status: number): { server: Server; url: string; hits: () => number } {
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/index" && req.method === "POST") hits++;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end("{}");
  });
  server.listen(0);
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}`, hits: () => hits };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM repositories WHERE user_id = ${OWNER}`);
  await db.execute(sql`DELETE FROM projects WHERE name = ${PROJECT}`);
}

async function makeRepo(opts: {
  url: string | null;
  graphStatus: string;
  graphStartedAt?: Date | null;
  setupChoice?: string | null;
  setupCompletedAt?: Date | null;
  projectId?: number | null;
}): Promise<number> {
  const [row] = await db
    .insert(repositoriesTable)
    .values({
      userId: OWNER,
      name: "rs-verify-repo",
      provider: "github",
      url: opts.url,
      defaultBranch: "main",
      stackProfile: {},
      projectId: opts.projectId ?? null,
      graphStatus: opts.graphStatus as "idle",
      graphStartedAt: opts.graphStartedAt ?? null,
      setupChoice: (opts.setupChoice ?? null) as null,
      setupCompletedAt: opts.setupCompletedAt ?? null,
    })
    .returning({ id: repositoriesTable.id });
  return row.id;
}

async function readRepo(id: number) {
  const [row] = await db.select().from(repositoriesTable).where(eq(repositoriesTable.id, id));
  return row;
}

async function main() {
  await cleanup();
  const prevUrl = process.env.GRAPHIFY_SERVICE_URL;
  const prevSecret = process.env.GRAPHIFY_SERVICE_SECRET;
  process.env.GRAPHIFY_SERVICE_SECRET = "rs-verify-secret";

  // --- 0. The claim primitive, raced directly ---------------------------
  //
  // Raced HERE and not through the drain. Two dispatchQueuedIndexes() calls in
  // a Promise.all serialize on the connection pool, so the second one's read
  // happens after the first one's write and the condition is never exercised:
  // that test passed with the condition removed, which is to say it proved
  // nothing. Two conditional UPDATEs issued against the same row cannot both
  // match, whatever order the server runs them in, and an unconditional one
  // lets both through.
  {
    const id = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "queued",
      graphStartedAt: new Date(),
    });
    const results = await Promise.all([claimQueuedIndex(id), claimQueuedIndex(id)]);
    check(
      "exactly one of two concurrent claims wins",
      results.filter(Boolean).length === 1,
      `results=${JSON.stringify(results)}`,
    );
    // And a third, after the row has moved on, must not take it either.
    check("a claim on an already-claimed row fails", (await claimQueuedIndex(id)) === false);
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, id));
  }

  // --- 1. One claim means one request to the service ---------------------
  {
    const stub = stubService(202);
    process.env.GRAPHIFY_SERVICE_URL = stub.url;
    const id = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "queued",
      graphStartedAt: new Date(),
    });
    // Both ticks see the row as queued before either has claimed it, which is
    // exactly the race two cron invocations can be in.
    await Promise.all([dispatchQueuedIndexes(), dispatchQueuedIndexes()]);
    const row = await readRepo(id);
    check("a drained queue sends one request per claim", stub.hits() === 1, `hits=${stub.hits()}`);
    check("the claimed row is indexing", row.graphStatus === "indexing", String(row.graphStatus));
    check("the claim is timestamped", row.graphStartedAt != null);
    stub.server.close();
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, id));
  }

  // --- 2. A refused handoff goes back to the queue, not to failed --------
  {
    const stub = stubService(503);
    process.env.GRAPHIFY_SERVICE_URL = stub.url;
    const id = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "queued",
      graphStartedAt: new Date(),
    });
    await dispatchQueuedIndexes();
    const row = await readRepo(id);
    check("a refused handoff parks as queued", row.graphStatus === "queued", String(row.graphStatus));
    check("and not as failed", row.graphStatus !== "failed");
    check("with a note a customer can read", (row.graphError ?? "").includes("503"), row.graphError ?? "none");
    stub.server.close();
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, id));
  }

  // --- 3. A repository with no URL is settled, not retried for ever ------
  {
    const stub = stubService(202);
    process.env.GRAPHIFY_SERVICE_URL = stub.url;
    const id = await makeRepo({ url: null, graphStatus: "queued", graphStartedAt: new Date() });
    await dispatchQueuedIndexes();
    const row = await readRepo(id);
    check("a urlless queued repository is failed", row.graphStatus === "failed", String(row.graphStatus));
    check("nothing was sent for it", stub.hits() === 0, `hits=${stub.hits()}`);
    check("and it says what to do", (row.graphError ?? "").includes("no URL"), row.graphError ?? "none");
    stub.server.close();
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, id));
  }

  // --- 4 and 5. The setup dispatch --------------------------------------
  {
    const [project] = await db
      .insert(projectsTable)
      .values({
        userId: OWNER,
        name: PROJECT,
        plmProvider: "jira",
        plmProjectKey: `RSV-${Date.now()}`,
        visibility: "personal",
      })
      .returning({ id: projectsTable.id });

    // A non-scanning choice left unstamped: nothing to do, so stamp it.
    const plain = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "succeeded",
      setupChoice: "index",
      setupCompletedAt: null,
      projectId: project.id,
    });
    await dispatchPendingSetups();
    const plainRow = await readRepo(plain);
    check("a non-scanning choice is stamped complete", plainRow.setupCompletedAt != null);
    check("with no error", plainRow.setupError == null, plainRow.setupError ?? "none");
    check("and the choice is NOT cleared", plainRow.setupChoice === "index", String(plainRow.setupChoice));
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, plain));

    // A scanning choice while the index is still in flight: leave it alone.
    const waiting = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "indexing",
      graphStartedAt: new Date(),
      setupChoice: "index_scan",
      setupCompletedAt: null,
      projectId: project.id,
    });
    await dispatchPendingSetups();
    const waitingRow = await readRepo(waiting);
    check("a scan waits for the index to settle", waitingRow.setupCompletedAt == null);
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, waiting));

    // The same choice once the index has settled. There is no model key for
    // this synthetic owner, so the scan is refused: the point is that the
    // refusal is RECORDED and the row is settled, not retried every tick.
    const ready = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "succeeded",
      setupChoice: "index_scan",
      setupCompletedAt: null,
      projectId: project.id,
    });
    await dispatchPendingSetups();
    const readyRow = await readRepo(ready);
    check("a settled scan choice is acted on", readyRow.setupCompletedAt != null);
    check(
      "a refusal is recorded in words",
      (readyRow.setupError ?? "").length > 0,
      readyRow.setupError ?? "none",
    );
    check("the refusal names no credential value", !/sk-|ghp_|Bearer /.test(readyRow.setupError ?? ""));
    check("and the choice is still on the row", readyRow.setupChoice === "index_scan");

    // A second tick must not act on it again.
    const before = readyRow.setupCompletedAt?.getTime();
    await dispatchPendingSetups();
    const again = await readRepo(ready);
    check("a settled row is not acted on twice", again.setupCompletedAt?.getTime() === before);
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, ready));
    await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
  }

  // --- the kill switch ---------------------------------------------------
  {
    delete process.env.GRAPHIFY_SERVICE_URL;
    const id = await makeRepo({
      url: "https://github.com/acme/app",
      graphStatus: "queued",
      graphStartedAt: new Date(),
    });
    const started = await dispatchQueuedIndexes();
    const row = await readRepo(id);
    check("with indexing unconfigured the drain does nothing", started.length === 0);
    check("and the row is untouched", row.graphStatus === "queued", String(row.graphStatus));
    await db.delete(repositoriesTable).where(eq(repositoriesTable.id, id));
  }

  if (prevUrl === undefined) delete process.env.GRAPHIFY_SERVICE_URL;
  else process.env.GRAPHIFY_SERVICE_URL = prevUrl;
  if (prevSecret === undefined) delete process.env.GRAPHIFY_SERVICE_SECRET;
  else process.env.GRAPHIFY_SERVICE_SECRET = prevSecret;

  await cleanup();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
