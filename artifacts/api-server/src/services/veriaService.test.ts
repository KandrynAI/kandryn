import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFindingPaths } from "./veriaService.js";

const P = "src/PnC.Api";

test("a finding tagged with a real change-set file keeps its filePath", () => {
  const out = validateFindingPaths(
    [{ type: "risk", filePath: `${P}/Services/PolicyService.cs` }],
    [`${P}/Services/PolicyService.cs`, `${P}/DTOs/PolicyDTOs.cs`],
  );
  assert.equal(out[0].filePath, `${P}/Services/PolicyService.cs`);
});

test("a finding tagged with a path not in the change set is dropped to change-spanning", () => {
  const out = validateFindingPaths(
    [{ type: "risk", filePath: `${P}/Services/Ghost.cs` }],
    [`${P}/Services/PolicyService.cs`],
  );
  // Never attached to a wrong file — filePath removed, finding retained.
  assert.equal(out[0].filePath, undefined);
  assert.equal(out.length, 1);
});

test("a change-spanning finding (no filePath) is left untouched", () => {
  const out = validateFindingPaths([{ type: "risk", title: "Cross-file mismatch" }], [`${P}/A.cs`]);
  assert.equal(out[0].filePath, undefined);
  assert.equal((out[0] as { title: string }).title, "Cross-file mismatch");
});
