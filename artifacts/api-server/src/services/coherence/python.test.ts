import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCoherence, buildRepoSymbolIndex } from "./index.js";
import { extractPythonSymbols, checkPython } from "./python.js";
import { buildSymbolTable } from "./symbols.js";
import type { SuggestionFile as SF } from "../../../../../shared/types/codeSuggestion.js";

function sf(filePath: string, content: string, op: SF["op"] = "create"): SF {
  return { seq: 0, op, filePath, content, resolved: true, applyStatus: "applied", linesAdded: 0, linesRemoved: 0 };
}

const noRepo = buildRepoSymbolIndex([]);
const DIR = "app";

const modelsSrc = `from dataclasses import dataclass

@dataclass
class Endorsement:
    id: int
    policy_id: int
    reason: str
`;

const serviceSrc = (extra = "") => `from app.models import Endorsement

class EndorsementService:
    def fetch(self, endorsement_id: int) -> Endorsement:
        return Endorsement(id=endorsement_id, policy_id=0, reason="")
    ${extra}
`;

// 1 — Positive: a coherent multi-file Python change passes with zero findings.
test("coherent multi-file Python change → passed, zero findings", () => {
  const r = checkCoherence([sf(`${DIR}/models.py`, modelsSrc), sf(`${DIR}/service.py`, serviceSrc())], noRepo);
  assert.equal(r.status, "passed", `expected passed, got ${JSON.stringify(r)}`);
  assert.equal(r.findings.length, 0, `expected zero findings, got ${JSON.stringify(r.findings)}`);
});

// 2 — Negative: a referenced type neither defined, imported, nor a builtin/typing
// name is caught by type_resolution.
test("referenced type not defined or imported → type_resolution warning", () => {
  const broken = serviceSrc("def draft(self) -> Coverage:\n        return build()\n");
  const r = checkCoherence([sf(`${DIR}/models.py`, modelsSrc), sf(`${DIR}/service.py`, broken)], noRepo);
  assert.ok(
    r.findings.some((f) => f.check === "type_resolution" && /Coverage/.test(f.message)),
    `expected a type_resolution finding for Coverage, got ${JSON.stringify(r.findings)}`,
  );
});

// 3 — caller_callee (name-only): a call on a receiver resolved via a typed
// constructor attribute to a type that declares no such method.
test("call to a missing method on a resolved receiver → caller_callee error", () => {
  const repo = `class EndorsementRepo:
    def get(self, endorsement_id: int):
        return None
`;
  const widget = `from app.repo import EndorsementRepo

class Widget:
    def __init__(self, repo: EndorsementRepo):
        self.repo = repo

    def load(self):
        self.repo.refresh()
`;
  const r = checkCoherence([sf(`${DIR}/repo.py`, repo), sf(`${DIR}/widget.py`, widget)], noRepo);
  const cc = r.findings.filter((f) => f.check === "caller_callee" && /refresh/.test(f.message));
  assert.ok(cc.length >= 1, `expected a caller_callee error for refresh, got ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "failed");
});

// 4 — False-positive guard: idiomatic Python (dataclass, typing generics,
// Optional, aliased imports, self-attribute annotations) must not fire.
test("idiomatic Python patterns produce zero false positives", () => {
  const fpModels = `from dataclasses import dataclass

@dataclass
class Row:
    id: int
    label: str
`;
  const fpUse = `from typing import Optional, List, Dict
from app.fp_models import Row

class Table:
    def __init__(self, rows: List[Row]):
        self.rows: List[Row] = rows
        self.index: Dict[str, Row] = {}

    def find(self, key: str) -> Optional[Row]:
        for r in self.rows:
            if r.label == key:
                return r
        return None
`;
  const r = checkCoherence([sf(`${DIR}/fp_models.py`, fpModels), sf(`${DIR}/fp_use.py`, fpUse)], noRepo);
  assert.equal(r.findings.length, 0, `expected zero false positives, got ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "passed");
});

// 5 — Wildcard import blocks type_resolution (cannot know what is in scope).
test("wildcard import → type_resolution skipped, no findings", () => {
  const a = `class Base:
    def run(self):
        return 1
`;
  const b = `from app.everything import *

class Impl:
    def go(self) -> Widget:
        return Widget()
`;
  const r = checkCoherence([sf(`${DIR}/base.py`, a), sf(`${DIR}/impl.py`, b)], noRepo);
  assert.equal(r.findings.length, 0, `wildcard import must suppress type_resolution, got ${JSON.stringify(r.findings)}`);
  assert.ok(r.skipped.some((s) => /wildcard/.test(s.reason)));
});

// 6 — Real code: the repo's own Python microservice must produce zero findings.
test("real graphify-service/main.py → zero false positives", () => {
  const src = readFileSync(new URL("../../../../../graphify-service/main.py", import.meta.url), "utf8");
  const main = extractPythonSymbols("graphify-service/main.py", src);
  // Pair with a trivial sibling so type_resolution actually evaluates.
  const sib = extractPythonSymbols("graphify-service/_models.py", "class Sibling:\n    pass\n");
  const combined = buildSymbolTable([main, sib]);
  const r = checkPython([main, sib], combined, new Set());
  assert.equal(r.findings.length, 0, `real main.py produced findings: ${JSON.stringify(r.findings)}`);
});

// 7 — Dispatch: Python routes through the registry (unsupported/mixed still pass).
test("mixed Python + C# → clean pass with a skip note", () => {
  const r = checkCoherence([sf(`${DIR}/models.py`, modelsSrc), sf("src/Legacy.cs", "public class Legacy { }")], noRepo);
  assert.equal(r.status, "passed");
  assert.ok(r.skipped.some((s) => /mixed/.test(s.reason)));
});
