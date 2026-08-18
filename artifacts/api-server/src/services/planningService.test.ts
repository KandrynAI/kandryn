import { test } from "node:test";
import assert from "node:assert/strict";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

// planningService imports @workspace/db, which throws at load without a
// DATABASE_URL. The pure helpers never touch the pool (node-postgres connects
// lazily), so a dummy URL lets the module import; no connection is opened.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { planOrderRank, orderPlannedFiles, validatePlan, rankCandidatePaths, buildCandidatesFromGraph } =
  await import("./planningService.js");

const P = "src/PnC.Api";

test("planOrderRank puts the endorsement slice in dependency order", () => {
  assert.equal(planOrderRank(`${P}/DTOs/PolicyDTOs.cs`), 0);
  assert.equal(planOrderRank(`${P}/Services/IPolicyService.cs`), 1);
  assert.equal(planOrderRank(`${P}/Services/PolicyService.cs`), 2);
  assert.equal(planOrderRank(`${P}/Controllers/PoliciesController.cs`), 3);
  assert.equal(planOrderRank("app/src/components/PolicyForm.tsx"), 4);
});

test("an interface under a Services/ directory ranks before its implementation", () => {
  // The whole point of the precedence fix: IPolicyService.cs must not be
  // classified as a service just because it lives in Services/.
  assert.ok(planOrderRank(`${P}/Services/IPolicyService.cs`) < planOrderRank(`${P}/Services/PolicyService.cs`));
});

test("orderPlannedFiles sorts a shuffled plan into dependency order, stably", () => {
  const shuffled = [
    { op: "edit" as const, path: `${P}/Controllers/PoliciesController.cs`, rationale: "add endpoint" },
    { op: "edit" as const, path: `${P}/Services/PolicyService.cs`, rationale: "implement" },
    { op: "edit" as const, path: `${P}/DTOs/PolicyDTOs.cs`, rationale: "add DTOs" },
    { op: "edit" as const, path: `${P}/Services/IPolicyService.cs`, rationale: "declare" },
  ];
  const ordered = orderPlannedFiles(shuffled).map((f) => f.path);
  assert.deepEqual(ordered, [
    `${P}/DTOs/PolicyDTOs.cs`,
    `${P}/Services/IPolicyService.cs`,
    `${P}/Services/PolicyService.cs`,
    `${P}/Controllers/PoliciesController.cs`,
  ]);
});

test("validatePlan enforces edit-exists, create-absent, and non-empty", () => {
  const tree = new Set([`${P}/Services/PolicyService.cs`, `${P}/DTOs/PolicyDTOs.cs`]);

  assert.deepEqual(
    validatePlan([{ op: "edit", path: `${P}/Services/PolicyService.cs`, rationale: "x" }], tree),
    { ok: true },
  );

  const editMissing = validatePlan([{ op: "edit", path: `${P}/Services/Ghost.cs`, rationale: "x" }], tree);
  assert.equal(editMissing.ok, false);
  assert.match((editMissing as { reason: string }).reason, /does not exist/);

  const createExisting = validatePlan([{ op: "create", path: `${P}/DTOs/PolicyDTOs.cs`, rationale: "x" }], tree);
  assert.equal(createExisting.ok, false);
  assert.match((createExisting as { reason: string }).reason, /already exists/);

  assert.deepEqual(
    validatePlan([{ op: "create", path: `${P}/Services/New.cs`, rationale: "x" }], tree),
    { ok: true },
  );

  assert.equal(validatePlan([], tree).ok, false);
});

test("validatePlan skips existence checks when the tree is unavailable", () => {
  assert.deepEqual(
    validatePlan([{ op: "edit", path: "anything.cs", rationale: "x" }], new Set()),
    { ok: true },
  );
});

test("rankCandidatePaths ranks by keyword hits, drops non-matches, and caps", () => {
  const paths = [
    `${P}/Services/PolicyService.cs`, // policy + service? no — keywords below
    `${P}/DTOs/PolicyDTOs.cs`,
    `${P}/Controllers/ClaimsController.cs`,
    "README.md",
  ];
  const ranked = rankCandidatePaths(paths, ["policy"], 25);
  const rankedPaths = ranked.map((c) => c.path);
  assert.ok(rankedPaths.includes(`${P}/Services/PolicyService.cs`));
  assert.ok(rankedPaths.includes(`${P}/DTOs/PolicyDTOs.cs`));
  assert.ok(!rankedPaths.includes("README.md")); // no keyword hit → dropped
  assert.ok(ranked.every((c) => c.source === "keyword" && c.symbols.length === 0));
  // Cap is respected.
  assert.ok(rankCandidatePaths(paths, ["policy", "claims"], 1).length === 1);
});

test("buildCandidatesFromGraph attaches the symbol names the graph holds per file", () => {
  const graph: GraphifyGraph = {
    nodes: [
      { id: "a", label: "EndorseAsync", fileType: "code", sourceFile: `${P}/Services/PolicyService.cs`, sourceLocation: `${P}/Services/PolicyService.cs:61` },
      { id: "b", label: "CancelAsync", fileType: "code", sourceFile: `${P}/Services/PolicyService.cs`, sourceLocation: `${P}/Services/PolicyService.cs:90` },
      { id: "c", label: "PolicyResponse", fileType: "code", sourceFile: `${P}/DTOs/PolicyDTOs.cs`, sourceLocation: `${P}/DTOs/PolicyDTOs.cs:20` },
    ],
    edges: [],
    metadata: { files: 2, nodes: 3, edges: 0 },
  };
  const candidates = buildCandidatesFromGraph(graph, ["policy"], 25);
  const svc = candidates.find((c) => c.path === `${P}/Services/PolicyService.cs`);
  assert.ok(svc, "PolicyService.cs should be a candidate");
  assert.ok(svc!.symbols.includes("EndorseAsync") && svc!.symbols.includes("CancelAsync"));
  assert.ok(candidates.every((c) => c.source === "graph"));
});
