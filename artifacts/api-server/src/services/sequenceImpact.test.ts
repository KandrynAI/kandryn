import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFactBundle, acceptanceLines, deterministicImpact, validateModelImpact,
  type FactBundleInput,
} from "./sequenceImpact.js";
import { parseGitHubPullRequestUrl, gitHubStateOf } from "./pullRequestState.js";
import type { SequenceFact, SequenceFinding } from "../../../../shared/types/sequence.js";

const baseInput = (over: Partial<FactBundleInput> = {}): FactBundleInput => ({
  defaultBranch: "main", itemKey: "PAY-B", itemTitle: "Add idempotency keys",
  acceptanceCriteria: null, scheduledAt: null, blockers: [], dependents: [],
  overlaps: [], openPrCountInSharedDirs: 0, ...over,
});

const finding = (over: Partial<SequenceFinding> = {}): SequenceFinding => ({
  id: "abc123", type: "unmet_blocker", severity: "warning", summary: "s",
  source: "tracker", confidence: "high", evidence: { itemKeys: ["PAY-A"] }, ...over,
});

// ---- fact bundle ------------------------------------------------------------

test("the branch model is always the first fact", () => {
  const facts = buildFactBundle(baseInput());
  assert.equal(facts[0].id, "F1");
  assert.match(facts[0].text, /default branch, "main"/);
});

test("fact ids are sequential and unique", () => {
  const facts = buildFactBundle(baseInput({
    blockers: [{ key: "PAY-A", title: "A", trackerStatus: "To Do", prState: "none", gateBlocked: false }],
    dependents: [{ key: "PAY-C", status: "To Do" }],
    overlaps: [{ file: "src/pay.ts", heldBy: ["PAY-D"] }],
  }));
  assert.deepEqual(facts.map((f) => f.id), facts.map((_, i) => `F${i + 1}`));
});

test("the bundle is deterministic for the same state", () => {
  const i = baseInput({ blockers: [{ key: "PAY-A", title: "A", trackerStatus: "To Do", prState: "open", gateBlocked: false }] });
  assert.deepEqual(buildFactBundle(i), buildFactBundle(i));
});

test("blocker facts carry tracker status, PR state and gate state", () => {
  const facts = buildFactBundle(baseInput({
    blockers: [{ key: "PAY-A", title: "A", trackerStatus: "In Progress", prState: "merged", gateBlocked: true }],
  }));
  const f = facts.find((x) => x.text.includes("PAY-A"))!;
  assert.match(f.text, /In Progress/);
  assert.match(f.text, /pull request that is merged/);
  assert.match(f.text, /security gate is blocked/);
});

test("an unreadable PR state says so rather than guessing", () => {
  const facts = buildFactBundle(baseInput({
    blockers: [{ key: "PAY-A", title: "A", trackerStatus: "To Do", prState: "unknown", gateBlocked: false }],
  }));
  assert.match(facts.find((x) => x.text.includes("PAY-A"))!.text, /could not be read/);
});

test("tracker-authored text is flagged untrusted; derived facts are not", () => {
  const facts = buildFactBundle(baseInput({ acceptanceCriteria: "- Must reject duplicates" }));
  const title = facts.find((f) => f.text.includes("is titled"))!;
  const ac = facts.find((f) => f.text.includes("Must reject duplicates"))!;
  assert.equal(title.untrusted, true, "a tracker title is user-written");
  assert.equal(ac.untrusted, true, "acceptance criteria are user-written");
  assert.notEqual(facts[0].untrusted, true, "the branch model is ours");
});

test("no fact is emitted for an absent schedule or empty overlap", () => {
  const facts = buildFactBundle(baseInput());
  assert.ok(!facts.some((f) => /scheduled for/.test(f.text)));
  assert.ok(!facts.some((f) => /is already being changed/.test(f.text)));
});

// ---- acceptance criteria ----------------------------------------------------

test("acceptanceLines strips bullet markers and blank lines", () => {
  assert.deepEqual(acceptanceLines("- one\n\n* two\n3. three\n   \n• four"), ["one", "two", "three", "four"]);
});

test("acceptanceLines caps at 8 lines and 200 characters", () => {
  assert.equal(acceptanceLines(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")).length, 8);
  const long = acceptanceLines("x".repeat(500))[0];
  assert.equal(long.length, 201, "200 characters plus the ellipsis");
  assert.ok(long.endsWith("…"));
});

test("acceptanceLines handles null and whitespace", () => {
  assert.deepEqual(acceptanceLines(null), []);
  assert.deepEqual(acceptanceLines("   \n\n  "), []);
});

// ---- deterministic assessment -----------------------------------------------

test("the deterministic assessment needs no facts and no model", () => {
  const impact = deterministicImpact([finding()], "PAY-B");
  assert.equal(impact.source, "deterministic");
  assert.equal(impact.risks.length, 1);
  assert.match(impact.risks[0].explanation, /default branch/);
  assert.match(impact.alternative, /PAY-A/);
});

test("every finding type yields a risk with a mitigation", () => {
  const types = ["unmet_blocker", "blocker_pr_unmerged", "blocker_gate_blocked", "children_incomplete",
    "file_overlap", "dependency_cycle", "out_of_rank", "inferred_prerequisite"] as const;
  for (const type of types) {
    const impact = deterministicImpact([finding({ type, evidence: { itemKeys: ["PAY-A"], files: ["src/a.ts"] } })], "PAY-B");
    assert.equal(impact.risks.length, 1, type);
    assert.ok(impact.risks[0].mitigation.length > 0, `${type} has no mitigation`);
    assert.ok(impact.risks[0].title.length > 0, `${type} has no title`);
  }
});

test("a clear check still produces a usable assessment", () => {
  const impact = deterministicImpact([], "PAY-B");
  assert.equal(impact.risks.length, 0);
  assert.match(impact.summary, /Nothing stands in the way/);
});

test("affected items and files are deduplicated and sorted", () => {
  const impact = deterministicImpact([
    finding({ evidence: { itemKeys: ["PAY-C", "PAY-A"], files: ["b.ts", "a.ts"] } }),
    finding({ type: "file_overlap", evidence: { itemKeys: ["PAY-A"], files: ["a.ts"] } }),
  ], "PAY-B");
  assert.deepEqual(impact.affectedItems, ["PAY-A", "PAY-C"]);
  assert.deepEqual(impact.affectedFiles, ["a.ts", "b.ts"]);
});

// ---- the grounding gate -----------------------------------------------------

const facts: SequenceFact[] = [{ id: "F1", text: "a" }, { id: "F2", text: "b" }];
const known = { items: ["PAY-A"], files: ["src/pay.ts"] };
const good = {
  summary: "s", alternative: "a", affectedItems: ["PAY-A"], affectedFiles: ["src/pay.ts"],
  risks: [{ title: "t", severity: "high", likelihood: "likely", explanation: "e", factRefs: ["F1"], mitigation: "m" }],
};

test("a well-formed grounded answer is accepted and marked as ai", () => {
  const out = validateModelImpact(good, facts, known, "m1");
  assert.equal(out?.source, "ai");
  assert.equal(out?.model, "m1");
  assert.equal(out?.risks.length, 1);
});

test("a risk citing a fact that does not exist is dropped", () => {
  const out = validateModelImpact({
    ...good,
    risks: [...good.risks, { title: "invented", severity: "high", likelihood: "likely", explanation: "e", factRefs: ["F9"], mitigation: "m" }],
  }, facts, known, "m1");
  assert.equal(out?.risks.length, 1);
  assert.equal(out?.risks[0].title, "t");
});

test("a risk citing no facts at all is dropped", () => {
  const out = validateModelImpact({ ...good, risks: [{ ...good.risks[0], factRefs: [] }] }, facts, known, "m1");
  assert.equal(out, null, "an uncited claim leaves nothing to stand on");
});

test("when no risk survives, the caller is told to fall back", () => {
  assert.equal(validateModelImpact({ ...good, risks: [{ ...good.risks[0], factRefs: ["F7"] }] }, facts, known, "m1"), null);
});

test("invented files and items are stripped from the answer", () => {
  const out = validateModelImpact({
    ...good,
    affectedItems: ["PAY-A", "PAY-NOPE"],
    affectedFiles: ["src/pay.ts", "src/invented.ts"],
  }, facts, known, "m1");
  assert.deepEqual(out?.affectedItems, ["PAY-A"]);
  assert.deepEqual(out?.affectedFiles, ["src/pay.ts"]);
});

test("malformed model output is rejected outright", () => {
  for (const bad of [null, undefined, "text", {}, { summary: "s" }, { ...good, risks: "nope" },
    { ...good, risks: [{ ...good.risks[0], severity: "catastrophic" }] }]) {
    assert.equal(validateModelImpact(bad, facts, known, "m1"), null, JSON.stringify(bad));
  }
});

// ---- PR url parsing ---------------------------------------------------------

test("a GitHub PR url parses into owner, repo and number", () => {
  assert.deepEqual(parseGitHubPullRequestUrl("https://github.com/KandrynAI/kandryn/pull/42"),
    { owner: "KandrynAI", repo: "kandryn", number: 42 });
  assert.deepEqual(parseGitHubPullRequestUrl("https://github.com/o/r/pull/7/files"),
    { owner: "o", repo: "r", number: 7 });
});

test("a non-GitHub or malformed PR url parses to null", () => {
  for (const u of [null, undefined, "", "https://dev.azure.com/o/p/_git/r/pullrequest/9",
    "https://github.com/o/r/issues/4", "https://github.com/o/r", "not a url"]) {
    assert.equal(parseGitHubPullRequestUrl(u), null, String(u));
  }
});

test("merged_at wins over state, because a merged PR also reads as closed", () => {
  assert.equal(gitHubStateOf({ state: "closed", merged_at: "2026-01-01T00:00:00Z" }), "merged");
  assert.equal(gitHubStateOf({ state: "closed", merged_at: null }), "closed");
  assert.equal(gitHubStateOf({ state: "open", merged_at: null }), "open");
  assert.equal(gitHubStateOf({}), "unknown");
});
