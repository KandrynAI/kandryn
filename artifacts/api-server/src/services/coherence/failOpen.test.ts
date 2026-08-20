import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoherence, buildRepoSymbolIndex } from "./index.js";
import type { SuggestionFile as SF } from "../../../../../shared/types/codeSuggestion.js";

// Regression guards for the error-tier fail-open property. A caller_callee /
// interface_impl ERROR blocks a commit, so it must fire only on POSITIVE
// evidence of a mismatch — never merely because the checker couldn't see the
// callee. Two ways the callee can be invisible, both of which must skip:
//   1. its type lives outside the bounded repo context (a Utils/ or Extensions/
//      helper the same-directory window never reads);
//   2. its type IS in scope but its methods weren't parsed (a single-line body).

function sf(filePath: string, content: string, op: SF["op"] = "edit"): SF {
  return { seq: 0, op, filePath, content, resolved: true, applyStatus: "applied", linesAdded: 0, linesRemoved: 0 };
}

test("out-of-range callee → skip, never an error (fail open on directory scope)", () => {
  const controller = sf(
    "src/Api/Controllers/PoliciesController.cs",
    `
namespace Api.Controllers;
public class PoliciesController {
  private readonly IHelper _helper;           // type lives in Extensions/, unread
  private readonly IPolicyService _svc;
  public PoliciesController(IHelper h, IPolicyService s) { _helper = h; _svc = s; }
  public void Get() {
    _helper.FormatOutOfRange(1, 2, 3);        // callee type NOT in context
    _svc.GetPolicy(5);                         // callee type IS in context
  }
}
`,
  );
  const service = sf(
    "src/Api/Services/PolicyService.cs",
    `
namespace Api.Services;
public interface IPolicyService
{
    void GetPolicy(int id);
}
public class PolicyService : IPolicyService
{
    public void GetPolicy(int id) {}
}
`,
  );
  // repoContext deliberately omits IHelper (out of the scanned directory window).
  const r = checkCoherence([controller, service], buildRepoSymbolIndex([]));

  const callerErrors = r.findings.filter((f) => f.check === "caller_callee" && f.severity === "error");
  assert.equal(callerErrors.length, 0, `no false caller_callee errors, got ${JSON.stringify(callerErrors)}`);
  assert.ok(
    r.skipped.some((s) => /FormatOutOfRange/.test(s.detail ?? "")),
    "the out-of-range call must be recorded as a skip",
  );
  assert.notEqual(r.status, "failed", "an unresolved out-of-range callee must not fail the gate");
});

test("single-line interface body → skip, never a false error (fail open on parse gap)", () => {
  const controller = sf(
    "src/Api/Controllers/PoliciesController.cs",
    `
namespace Api.Controllers;
public class PoliciesController {
  private readonly IPolicyService _svc;
  public PoliciesController(IPolicyService s) { _svc = s; }
  public void Get() { _svc.GetPolicy(5); }
}
`,
  );
  // Single-line interface + impl bodies: the inline members are not extracted,
  // so the type is indexed with zero methods. The checker must NOT assert the
  // method is absent.
  const service = sf(
    "src/Api/Services/PolicyService.cs",
    `
namespace Api.Services;
public interface IPolicyService { void GetPolicy(int id); }
public class PolicyService : IPolicyService { public void GetPolicy(int id) {} }
`,
  );
  const r = checkCoherence([controller, service], buildRepoSymbolIndex([]));

  const errors = r.findings.filter((f) => f.severity === "error");
  assert.equal(errors.length, 0, `no false errors on single-line bodies, got ${JSON.stringify(errors)}`);
  assert.notEqual(r.status, "failed");
});
