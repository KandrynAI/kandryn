import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFindingPaths } from "./veriaService.js";

const P = "src/PnC.Api";
type F = { type: string; title?: string; filePath?: string };

test("a finding tagged with a real change-set file keeps its filePath", () => {
  const input: F[] = [{ type: "risk", filePath: `${P}/Services/PolicyService.cs` }];
  const out = validateFindingPaths(input, [`${P}/Services/PolicyService.cs`, `${P}/DTOs/PolicyDTOs.cs`]);
  assert.equal(out[0].filePath, `${P}/Services/PolicyService.cs`);
});

test("a finding tagged with a path not in the change set is dropped to change-spanning", () => {
  const input: F[] = [{ type: "risk", filePath: `${P}/Services/Ghost.cs` }];
  const out = validateFindingPaths(input, [`${P}/Services/PolicyService.cs`]);
  // Never attached to a wrong file — filePath removed, finding retained.
  assert.equal(out[0].filePath, undefined);
  assert.equal(out.length, 1);
});

test("a change-spanning finding (no filePath) is left untouched", () => {
  const input: F[] = [{ type: "risk", title: "Cross-file mismatch" }];
  const out = validateFindingPaths(input, [`${P}/A.cs`]);
  assert.equal(out[0].filePath, undefined);
  assert.equal(out[0].title, "Cross-file mismatch");
});
