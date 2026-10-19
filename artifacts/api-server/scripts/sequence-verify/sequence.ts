// The run-order analysis: spec tests 1-10, plus policy, persistence and isolation.
// Needs DATABASE_URL — see README.md.
import {
  db, tasksTable, projectsTable, teamsTable, teamMembersTable, runsTable,
  suggestionsTable, suggestionFilesTable, workItemLinksTable, sequenceChecksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { analyzeWorkItem, projectRunOrder, type SequenceActor } from "../../src/services/sequenceService.js";

const U = "u1";
let pass = 0, fail = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};
const actor: SequenceActor = { userId: U, teamId: null, teamRole: null };

async function reset(policy: string | null = null) {
  await db.delete(sequenceChecksTable); await db.delete(workItemLinksTable);
  await db.delete(suggestionFilesTable); await db.delete(suggestionsTable);
  await db.delete(runsTable); await db.delete(tasksTable);
  await db.delete(projectsTable); await db.delete(teamMembersTable); await db.delete(teamsTable);
  const [team] = await db.insert(teamsTable).values({ name: "T", ownerUserId: U, sequencePolicy: policy as never }).returning();
  const [proj] = await db.insert(projectsTable).values({
    userId: U, name: "P", plmProvider: "jira", plmProjectKey: "PAY", teamId: team.id,
  }).returning();
  return { team, proj };
}
async function mkTask(projId: number, key: string, extra: Record<string, unknown> = {}) {
  const [r] = await db.insert(tasksTable).values({
    userId: U, projectId: projId, externalId: key, source: "jira", type: "task", title: key, ...extra,
  }).returning();
  return r;
}
async function link(projId: number, teamId: number, from: number, to: number, extra = {}) {
  await db.insert(workItemLinksTable).values({
    userId: U, teamId, projectId: projId, fromItemId: from, toItemId: to,
    linkType: "blocks", source: "tracker", ...extra,
  });
}
/** A committed run with a PR, optionally gate-blocked, optionally touching files. */
async function committedRun(projId: number, itemId: number, opts: { gate?: string; files?: string[] } = {}) {
  const [run] = await db.insert(runsTable).values({
    userId: U, projectId: projId, workItemId: itemId, status: "succeeded", trigger: "manual",
    prUrl: `https://github.com/o/r/pull/${itemId}`, commitHash: "abc",
    securityGate: (opts.gate ?? null) as never,
  }).returning();
  const [sug] = await db.insert(suggestionsTable).values({
    runId: run.id, agent: "claude", explanation: "x", language: "ts",
  }).returning();
  for (const [i, f] of (opts.files ?? []).entries()) {
    await db.insert(suggestionFilesTable).values({ suggestionId: sug.id, seq: i, op: "edit", filePath: f, content: "x" });
  }
  await db.update(runsTable).set({ committedSuggestionId: sug.id }).where(eq(runsTable.id, run.id));
  return run;
}
const types = (c: { findings: { type: string }[] }) => c.findings.map((f) => f.type).sort();

async function main() {
  // 1
  let { proj, team } = await reset();
  let B = await mkTask(proj.id, "PAY-B");
  let c = await analyzeWorkItem(B.id, actor);
  t("1. no links -> clear", c.verdict === "clear" && c.findings.length === 0, JSON.stringify(types(c)));

  // 2
  ({ proj, team } = await reset());
  let A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  c = await analyzeWorkItem(B.id, actor);
  t("2. A blocks B, A not started -> warning unmet_blocker",
    c.verdict === "warning" && types(c).includes("unmet_blocker"), JSON.stringify(types(c)));
  t("2b. suggestedFirst = [A]",
    c.suggestedFirst.length === 1 && c.suggestedFirst[0].itemKey === "PAY-A", JSON.stringify(c.suggestedFirst));

  // 3
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A", { status: "done" }); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  c = await analyzeWorkItem(B.id, actor);
  t("3. A done -> clear", c.verdict === "clear", JSON.stringify(types(c)));

  // 4
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  await committedRun(proj.id, A.id);
  c = await analyzeWorkItem(B.id, actor);
  t("4. A has an open PR -> caution blocker_pr_unmerged",
    c.verdict === "caution" && types(c).includes("blocker_pr_unmerged"), JSON.stringify(types(c)));

  // 5
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  await committedRun(proj.id, A.id, { gate: "blocked" });
  c = await analyzeWorkItem(B.id, actor);
  t("5. A's gate is blocked -> warning blocker_gate_blocked",
    c.verdict === "warning" && types(c).includes("blocker_gate_blocked"), JSON.stringify(types(c)));

  // 6
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  const C = await mkTask(proj.id, "PAY-C");
  await link(proj.id, team.id, A.id, B.id); await link(proj.id, team.id, B.id, C.id);
  c = await analyzeWorkItem(C.id, actor);
  t("6. chain -> suggestedFirst ordered [A, B]",
    c.suggestedFirst.map((s) => s.itemKey).join(",") === "PAY-A,PAY-B", JSON.stringify(c.suggestedFirst.map(s=>s.itemKey)));

  // 7
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id); await link(proj.id, team.id, B.id, A.id);
  const started = Date.now();
  c = await analyzeWorkItem(B.id, actor);
  t("7. cycle -> warning dependency_cycle, no hang",
    c.verdict === "warning" && types(c).includes("dependency_cycle") && Date.now() - started < 5000,
    JSON.stringify(types(c)));

  // 8
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await committedRun(proj.id, A.id, { files: ["src/pay.ts", "src/other.ts"] });
  await committedRun(proj.id, B.id, { files: ["src/pay.ts"] });
  c = await analyzeWorkItem(B.id, actor);
  const ov = c.findings.find((f) => f.type === "file_overlap");
  t("8. file overlap -> warning naming the file",
    c.verdict === "warning" && !!ov && ov.evidence.files?.includes("src/pay.ts") === true, JSON.stringify(types(c)));
  t("8b. overlap on two committed sets is high confidence", ov?.confidence === "high", ov?.confidence);

  // 9
  ({ proj, team } = await reset());
  const parent = await mkTask(proj.id, "PAY-EPIC", { itemType: "story" });
  await mkTask(proj.id, "PAY-CH1", { parentId: parent.id });
  await mkTask(proj.id, "PAY-CH2", { parentId: parent.id, status: "done" });
  c = await analyzeWorkItem(parent.id, actor);
  const ch = c.findings.find((f) => f.type === "children_incomplete");
  t("9. open children -> caution", c.verdict === "caution" && !!ch, JSON.stringify(types(c)));
  t("9b. a done child is not counted", ch?.evidence.itemKeys?.join() === "PAY-CH1", JSON.stringify(ch?.evidence.itemKeys));

  // 10
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id, { dismissedAt: new Date(), dismissedBy: U });
  c = await analyzeWorkItem(B.id, actor);
  t("10. dismissed links are ignored", c.verdict === "clear", JSON.stringify(types(c)));

  // policy
  ({ proj, team } = await reset("off"));
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  c = await analyzeWorkItem(B.id, actor);
  t("policy 'off' -> clear with no findings", c.verdict === "clear" && c.findings.length === 0, JSON.stringify(types(c)));

  ({ proj, team } = await reset("admin_override_only"));
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  const member: SequenceActor = { userId: U, teamId: team.id, teamRole: "member" };
  const adminActor: SequenceActor = { userId: U, teamId: team.id, teamRole: "admin" };
  t("admin_override_only: member cannot override", (await analyzeWorkItem(B.id, member)).canOverride === false);
  t("admin_override_only: admin can override", (await analyzeWorkItem(B.id, adminActor)).canOverride === true);

  // persistence + staleness
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  const first = await analyzeWorkItem(B.id, actor);
  const [stored] = await db.select().from(sequenceChecksTable).where(eq(sequenceChecksTable.id, first.checkId));
  t("check is persisted with its verdict and findings",
    stored.verdict === "warning" && (stored.findings as unknown[]).length === 1);
  t("check expires in the future", stored.expiresAt > new Date());
  const second = await analyzeWorkItem(B.id, actor);
  t("fingerprint is stable while nothing changes", stored.fingerprint === (await db.select().from(sequenceChecksTable).where(eq(sequenceChecksTable.id, second.checkId)))[0].fingerprint);
  await db.update(tasksTable).set({ status: "done" }).where(eq(tasksTable.id, A.id));
  const third = await analyzeWorkItem(B.id, actor);
  t("fingerprint moves when the blocker completes",
    third.verdict === "clear" && (await db.select().from(sequenceChecksTable).where(eq(sequenceChecksTable.id, third.checkId)))[0].fingerprint !== stored.fingerprint);

  // waves
  ({ proj, team } = await reset());
  A = await mkTask(proj.id, "PAY-A"); B = await mkTask(proj.id, "PAY-B");
  await link(proj.id, team.id, A.id, B.id);
  const order = await projectRunOrder(proj.id, actor);
  t("run order: A in wave 1, B in wave 2",
    order.items.find((i) => i.itemKey === "PAY-A")?.wave === 1 &&
    order.items.find((i) => i.itemKey === "PAY-B")?.wave === 2, JSON.stringify(order.items));

  // isolation
  ({ proj, team } = await reset());
  B = await mkTask(proj.id, "PAY-B");
  let denied = false;
  try { await analyzeWorkItem(B.id, { userId: "someone-else", teamId: null, teamRole: null }); }
  catch (e) { denied = (e as { status?: number }).status === 404; }
  t("another user's work item is not found", denied);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
