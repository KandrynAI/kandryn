import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoherence, buildRepoSymbolIndex } from "./index.js";
import type { SuggestionFile as SF } from "../../../../../shared/types/codeSuggestion.js";

// A minimal applied SuggestionFile for the checker (only the fields it reads).
function sf(filePath: string, content: string, op: SF["op"] = "edit"): SF {
  return { seq: 0, op, filePath, content, resolved: true, applyStatus: "applied", linesAdded: 0, linesRemoved: 0 };
}

const noRepo = buildRepoSymbolIndex([]);

const DIR = "frontend/src";
const TYPES = `${DIR}/types/index.ts`;
const API = `${DIR}/services/api.ts`;
const PAGE = `${DIR}/pages/EndorsementPage.tsx`;

const typesSrc = `export interface Endorsement {
  id: number;
  policyId: number;
  reason: string;
}`;

const apiSrc = `import type { Endorsement } from "../types";
export function fetchEndorsement(id: number): Promise<Endorsement> {
  return fetch(\`/api/endorsements/\${id}\`).then((r) => r.json());
}`;

const pageSrc = (extra = "") => `import { useState } from "react";
import type { Endorsement } from "../types";
import { fetchEndorsement } from "../services/api";

export function EndorsementPage() {
  const [data, setData] = useState<Endorsement | null>(null);
  const load = async (id: number) => {
    const e = await fetchEndorsement(id);
    setData(e);
  };
  ${extra}
  return <div>Status: {data?.reason}</div>;
}`;

// 1 — Positive: a coherent three-file TypeScript change passes with zero findings.
test("coherent three-file TS change → passed, zero findings", () => {
  const r = checkCoherence([sf(TYPES, typesSrc, "create"), sf(API, apiSrc, "create"), sf(PAGE, pageSrc())], noRepo);
  assert.equal(r.status, "passed", `expected passed, got ${JSON.stringify(r)}`);
  assert.equal(r.findings.length, 0, `expected zero findings, got ${JSON.stringify(r.findings)}`);
});

// 2 — Negative (redefined per PR 0): a referenced type that is neither defined,
// imported, nor a lib/utility type is caught as a type_resolution finding.
test("referenced type not defined or imported → type_resolution warning", () => {
  const broken = pageSrc("const draft: Coverage = buildDraft();");
  const r = checkCoherence([sf(TYPES, typesSrc, "create"), sf(PAGE, broken)], noRepo);
  assert.ok(
    r.findings.some((f) => f.check === "type_resolution" && /Coverage/.test(f.message)),
    `expected a type_resolution finding for Coverage, got ${JSON.stringify(r.findings)}`,
  );
});

// 3 — caller_callee (name-only): a call on a receiver whose type is known but
// declares no such member is an error.
test("call to a missing member on a resolved receiver → caller_callee error", () => {
  const client = `export class EndorsementClient {
  get(id: number): Promise<void> { return Promise.resolve(); }
}`;
  const widget = `import { EndorsementClient } from "./client";
export class Widget {
  constructor(private client: EndorsementClient) {}
  load() {
    this.client.refresh();
  }
}`;
  const r = checkCoherence([sf(`${DIR}/client.ts`, client, "create"), sf(`${DIR}/widget.ts`, widget, "create")], noRepo);
  const cc = r.findings.filter((f) => f.check === "caller_callee" && /refresh/.test(f.message));
  assert.ok(cc.length >= 1, `expected a caller_callee error for refresh, got ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "failed");
});

// 4 — False-positive guard: idiomatic TS (generics, arrow functions, type-only
// imports, utility types, JSX text with a colon) must not produce findings.
test("idiomatic TS patterns produce zero false positives", () => {
  const fpTypes = `export interface Row { id: number; label: string; }
export type RowMap = Record<string, Row>;`;
  const fpComp = `import type { FC } from "react";
import type { Row, RowMap } from "./fpTypes";

interface Props<T> {
  items: T[];
  onSelect: (row: T) => void;
}

export const Table: FC<Props<Row>> = ({ items, onSelect }) => {
  const map: Partial<RowMap> = {};
  const handle = (r: Row): void => onSelect(r);
  return <ul>{items.map((it) => <li key={it.id}>Label: {it.label}</li>)}</ul>;
};`;
  const r = checkCoherence([sf(`${DIR}/fpTypes.ts`, fpTypes, "create"), sf(`${DIR}/fpComp.tsx`, fpComp, "create")], noRepo);
  assert.equal(r.findings.length, 0, `expected zero false positives, got ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "passed");
});

// 5 — Dispatch: a mixed-language suggestion and an unsupported-language one both
// pass cleanly with a skip note rather than running a single language's checks.
test("mixed languages → clean pass with a skip note", () => {
  const r = checkCoherence([sf(TYPES, typesSrc, "create"), sf(`${DIR}/Legacy.cs`, "public class Legacy { }", "create")], noRepo);
  assert.equal(r.status, "passed");
  assert.equal(r.findings.length, 0);
  assert.ok(r.skipped.some((s) => /mixed/.test(s.reason)), `expected a mixed-language skip, got ${JSON.stringify(r.skipped)}`);
});

test("unsupported language → clean pass", () => {
  const r = checkCoherence([sf("a.py", "class A: pass", "create"), sf("b.py", "class B: pass", "create")], noRepo);
  assert.equal(r.status, "passed");
  assert.equal(r.findings.length, 0);
});

// 6 — Regression: a C# change still routes to the C# checker through the new
// dispatch and produces its findings (the full C# suite is coherence.test.ts).
test("C# still dispatches to the C# checker", () => {
  const iface = `namespace App;
public interface IThing
{
    void DoIt(int x);
}`;
  const impl = `namespace App;
public class Thing : IThing
{
    public void Other() { }
}`;
  const r = checkCoherence([sf("src/IThing.cs", iface, "create"), sf("src/Thing.cs", impl, "create")], noRepo);
  assert.ok(
    r.findings.some((f) => f.check === "interface_impl"),
    `expected a C# interface_impl finding, got ${JSON.stringify(r.findings)}`,
  );
});
