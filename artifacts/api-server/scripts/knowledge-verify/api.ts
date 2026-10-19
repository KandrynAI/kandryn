// The knowledge routes over HTTP, auth stubbed: spec tests 13-15, plus the
// read/write access split. Needs DATABASE_URL — see README.md.
//
// Storage is NOT configured here on purpose. Every test below is about what
// the routes decide before a byte reaches a bucket: validation, access, and
// the not-configured answer. The parse-and-index path is covered by
// documentParser.test.ts and retrieval.ts.
import express from "express";
import { db, knowledgeChunksTable, knowledgeSourcesTable, projectsTable, teamsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import knowledgeRouter from "../../src/routes/knowledge.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

let CURRENT = { userId: "u1", teamId: null as number | null, teamRole: null as string | null };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as never as Record<string, unknown>).userId = CURRENT.userId;
  (req as never as Record<string, unknown>).teamId = CURRENT.teamId;
  (req as never as Record<string, unknown>).teamRole = CURRENT.teamRole;
  (req as never as Record<string, unknown>).log = logger;
  next();
});
app.use(knowledgeRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
  logger.error({ err }, "test app error");
  res.status(500).json({ error: err.message });
});

const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

const upload = (over: Record<string, unknown> = {}) => ({
  fileName: "architecture.md",
  mimeType: "text/markdown",
  sizeBytes: 2048,
  docType: "requirements",
  ...over,
});

async function seed() {
  await db.delete(knowledgeChunksTable);
  await db.delete(knowledgeSourcesTable);
  await db.delete(projectsTable);
  await db.delete(teamsTable);
  const [mine] = await db
    .insert(projectsTable)
    .values({ userId: "u1", name: "Mine", plmProvider: "jira", plmProjectKey: "MINE" })
    .returning();
  const [theirs] = await db
    .insert(projectsTable)
    .values({ userId: "u2", name: "Theirs", plmProvider: "jira", plmProjectKey: "THEIRS" })
    .returning();
  const [source] = await db
    .insert(knowledgeSourcesTable)
    .values({
      userId: "u2",
      projectId: theirs.id,
      docType: "architecture",
      title: "their doc",
      fileName: "their.md",
      mimeType: "text/markdown",
      sizeBytes: 10,
      storagePath: "u2/x/their.md",
      status: "pending",
    })
    .returning();
  return { mine, theirs, theirSource: source };
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { mine, theirs, theirSource } = await seed();
  CURRENT = { userId: "u1", teamId: null, teamRole: null };

  // 15. storage not configured -> 503, and nothing else breaks: the LIST still
  //     answers, so the page can render its own not-configured state.
  const un = await call("POST", `/projects/${mine.id}/knowledge/uploads`, upload());
  t("15. upload with storage unconfigured -> 503", un.status === 503, JSON.stringify(un.body));
  const list = await call("GET", `/projects/${mine.id}/knowledge`);
  t(
    "15b. the list still answers and reports storage as unconfigured",
    list.status === 200 && list.body.storageConfigured === false && list.body.sources.length === 0,
    JSON.stringify(list.body),
  );

  // 13. validation runs BEFORE the storage check, so a bad request is refused
  //     on its own terms rather than hidden behind a 503.
  const exe = await call("POST", `/projects/${mine.id}/knowledge/uploads`, upload({ fileName: "payload.exe" }));
  t("13. a .exe upload request -> 400", exe.status === 400, `${exe.status} ${JSON.stringify(exe.body)}`);

  const big = await call("POST", `/projects/${mine.id}/knowledge/uploads`, upload({ sizeBytes: 20 * 1024 * 1024 }));
  t("13b. an oversize upload request -> 400", big.status === 400, `${big.status} ${JSON.stringify(big.body)}`);

  const badType = await call("POST", `/projects/${mine.id}/knowledge/uploads`, upload({ docType: "legal" }));
  t("13c. an unknown docType -> 400", badType.status === 400, String(badType.status));

  const noBody = await call("POST", `/projects/${mine.id}/knowledge/uploads`, {});
  t("13d. a missing body -> 400", noBody.status === 400, String(noBody.status));

  // 14. complete on another user's sourceId -> 404 (not 403: the project is
  //     not the caller's to know about).
  const other = await call("POST", `/projects/${theirs.id}/knowledge/uploads/${theirSource.id}/complete`);
  t("14. complete on another user's source -> 404", other.status === 404, `${other.status} ${JSON.stringify(other.body)}`);

  // And the same for every other verb on a project the caller cannot see.
  const theirList = await call("GET", `/projects/${theirs.id}/knowledge`);
  t("14b. listing another user's project -> 404", theirList.status === 404, String(theirList.status));
  const theirDelete = await call("DELETE", `/projects/${theirs.id}/knowledge/${theirSource.id}`);
  t("14c. deleting another user's source -> 404", theirDelete.status === 404, String(theirDelete.status));

  // A source id that belongs to a DIFFERENT project of the caller's own is
  // also 404 — the row is scoped by project, not just by user.
  const crossProject = await call("DELETE", `/projects/${mine.id}/knowledge/${theirSource.id}`);
  t("14d. a source id from another project -> 404", crossProject.status === 404, String(crossProject.status));

  // Read vs write: a non-admin member of a team-visible project may LIST but
  // not upload. canAdminister requires the admin role when a team owns it.
  const [team] = await db.insert(teamsTable).values({ name: "T", ownerUserId: "u3" }).returning();
  const [teamProject] = await db
    .insert(projectsTable)
    .values({
      userId: "u3",
      name: "Team",
      plmProvider: "jira",
      plmProjectKey: "TEAM",
      teamId: team.id,
      visibility: "team",
    })
    .returning();
  CURRENT = { userId: "u1", teamId: team.id, teamRole: "member" };

  const memberList = await call("GET", `/projects/${teamProject.id}/knowledge`);
  t(
    "a team member may read the list, and is told they cannot upload",
    memberList.status === 200 && memberList.body.canUpload === false,
    JSON.stringify(memberList.body),
  );
  const memberUpload = await call("POST", `/projects/${teamProject.id}/knowledge/uploads`, upload());
  t("a team member may not upload -> 404", memberUpload.status === 404, String(memberUpload.status));

  CURRENT = { userId: "u1", teamId: team.id, teamRole: "admin" };
  const adminList = await call("GET", `/projects/${teamProject.id}/knowledge`);
  t("a team admin is told they may upload", adminList.body?.canUpload === true, JSON.stringify(adminList.body));

  // --- The upload-fix prompt's numbered server tests ---------------------
  CURRENT = { userId: "u1", teamId: null, teamRole: null };
  const { mine: p2 } = await seed();

  // 2. A signed-URL failure must leave no knowledge_sources row. Storage is
  //    unconfigured here, which is the earliest possible failure of that call.
  const failedUpload = await call("POST", `/projects/${p2.id}/knowledge/uploads`, upload());
  const afterFail = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(eq(knowledgeSourcesTable.projectId, p2.id));
  t(
    "2. a failed signed-URL call leaves no source row",
    afterFail.length === 0 && failedUpload.status === 503,
    `${afterFail.length} rows, status ${failedUpload.status}`,
  );

  // A row to work the rest of the tests against, in each interesting status.
  const mk = async (over: Record<string, unknown> = {}) => {
    const [row] = await db
      .insert(knowledgeSourcesTable)
      .values({
        userId: "u1",
        projectId: p2.id,
        docType: "architecture",
        title: "Platform architecture",
        fileName: "arch.md",
        mimeType: "text/markdown",
        sizeBytes: 120,
        storagePath: "u1/x/arch.md",
        status: "ready",
        chunkCount: 2,
        ...over,
      })
      .returning();
    return row;
  };

  // 4. PATCH validation.
  const ready = await mk();
  const empty = await call("PATCH", `/projects/${p2.id}/knowledge/${ready.id}`, {});
  t("4. PATCH with an empty body -> 400", empty.status === 400, String(empty.status));
  const patchBadType = await call("PATCH", `/projects/${p2.id}/knowledge/${ready.id}`, { docType: "legal" });
  t("4b. PATCH with an unknown docType -> 400", patchBadType.status === 400, String(patchBadType.status));
  const longTitle = await call("PATCH", `/projects/${p2.id}/knowledge/${ready.id}`, { title: "x".repeat(201) });
  t("4c. PATCH with a title over 200 chars -> 400", longTitle.status === 400, String(longTitle.status));
  const okPatch = await call("PATCH", `/projects/${p2.id}/knowledge/${ready.id}`, {
    title: "Renamed",
    docType: "requirements",
  });
  t(
    "4d. PATCH renames and retypes the document",
    okPatch.status === 200 && okPatch.body.title === "Renamed" && okPatch.body.docType === "requirements",
    JSON.stringify(okPatch.body),
  );
  CURRENT = { userId: "u2", teamId: null, teamRole: null };
  const foreignPatch = await call("PATCH", `/projects/${p2.id}/knowledge/${ready.id}`, { title: "Mine now" });
  t("4e. PATCH on another user's source -> 404", foreignPatch.status === 404, String(foreignPatch.status));
  CURRENT = { userId: "u1", teamId: null, teamRole: null };

  // 5. Replace: the target must belong to this user and project.
  const otherProjectRow = await db
    .insert(projectsTable)
    .values({ userId: "u1", name: "Other", plmProvider: "jira", plmProjectKey: "OTH" })
    .returning();
  const elsewhere = await mk({ projectId: otherProjectRow[0].id, storagePath: "u1/y/other.md" });
  const replaceCrossProject = await call("POST", `/projects/${p2.id}/knowledge/uploads`, upload({ replaceSourceId: elsewhere.id }));
  t(
    "5. replaceSourceId from another project is rejected",
    replaceCrossProject.status === 404,
    `${replaceCrossProject.status} ${JSON.stringify(replaceCrossProject.body)}`,
  );
  const missingTarget = await call("POST", `/projects/${p2.id}/knowledge/uploads`, upload({ replaceSourceId: 999999 }));
  t("5b. an unknown replaceSourceId is rejected", missingTarget.status === 404, String(missingTarget.status));
  // The replace target is resolved BEFORE storage is consulted, so a bad id
  // is a 404 rather than the 503 an unconfigured deploy would otherwise give.
  const goodTarget = await call("POST", `/projects/${p2.id}/knowledge/uploads`, upload({ replaceSourceId: ready.id }));
  t(
    "5c. a valid replace target gets past validation to the storage check",
    goodTarget.status === 503,
    `${goodTarget.status} ${JSON.stringify(goodTarget.body)}`,
  );
  const stillThere = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, ready.id));
  t("5d. a failed replace leaves the original untouched", stillThere.length === 1 && stillThere[0].status === "ready");

  // 6. Delete works when the storage object is missing — here storage cannot
  //    even be reached, which is the harshest version of that case.
  const del = await call("DELETE", `/projects/${p2.id}/knowledge/${ready.id}`);
  const gone = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, ready.id));
  t("6. delete succeeds with no storage object", del.status === 204 && gone.length === 0, `${del.status}`);

  // 7. The list hides nothing: pending and failed rows are returned.
  const pending = await mk({ status: "pending", title: "Still uploading", chunkCount: 0 });
  const failed = await mk({ status: "failed", title: "Bad file", error: "No readable text was found.", chunkCount: 0 });
  const listed = await call("GET", `/projects/${p2.id}/knowledge`);
  const ids = (listed.body.sources as Array<{ id: number; status: string }>).map((r) => r.id);
  t(
    "7. the list returns pending and failed rows",
    ids.includes(pending.id) && ids.includes(failed.id),
    JSON.stringify(listed.body.sources),
  );
  const failedRow = (listed.body.sources as Array<{ id: number; status: string; error: string | null }>).find(
    (r) => r.id === failed.id,
  );
  t("7b. a failed row carries its reason", failedRow?.status === "failed" && !!failedRow?.error, JSON.stringify(failedRow));

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}

main();
