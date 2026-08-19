import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoherence, buildRepoSymbolIndex } from "./index.js";
import type { SuggestionFile as SF } from "../../../../../shared/types/codeSuggestion.js";

// A minimal applied SuggestionFile for the checker (only the fields it reads).
function sf(filePath: string, content: string, op: SF["op"] = "edit"): SF {
  return { seq: 0, op, filePath, content, resolved: true, applyStatus: "applied", linesAdded: 0, linesRemoved: 0 };
}

const DIR = "src/PnC.Api";
const IFACE = `${DIR}/Services/IPolicyService.cs`;
const IMPL = `${DIR}/Services/PolicyService.cs`;
const CTRL = `${DIR}/Controllers/PoliciesController.cs`;
const DTOS = `${DIR}/DTOs/PolicyDTOs.cs`;

// Unchanged repo files the change refers to.
const repo = buildRepoSymbolIndex([
  { filePath: `${DIR}/Data/AppDbContext.cs`, content: `namespace PnC.Api.Data;\npublic class AppDbContext { public object Policies; }` },
  { filePath: `${DIR}/Models/Policy.cs`, content: `namespace PnC.Api.Models;\npublic class Policy { }` },
]);

const ifaceSrc = (method: string) => `namespace PnC.Api.Services;
public interface IPolicyService
{
    Task<PolicyResponse?> ${method}(int id, EndorsePolicyRequest request);
    Task<PolicyResponse?> CancelAsync(int id, CancelPolicyRequest request);
}`;

const implSrc = (method: string) => `namespace PnC.Api.Services;
using PnC.Api.Data;
public class PolicyService : IPolicyService
{
    private readonly AppDbContext _db;
    public PolicyService(AppDbContext db) { _db = db; }
    public async Task<PolicyResponse?> ${method}(int id, EndorsePolicyRequest request)
    {
        return MapToResponse(null);
    }
    public async Task<PolicyResponse?> CancelAsync(int id, CancelPolicyRequest request) { return null; }
    private PolicyResponse MapToResponse(Policy p) { return new PolicyResponse(); }
}`;

const ctrlSrc = (call: string, extra = "") => `namespace PnC.Api.Controllers;
using PnC.Api.Services;
using PnC.Api.DTOs;
public class PoliciesController
{
    private readonly IPolicyService _policyService;
    ${extra}
    public PoliciesController(IPolicyService policyService) { _policyService = policyService; }
    public async Task<PolicyResponse?> EndorsePolicy(int id, EndorsePolicyRequest request)
    {
        return await _policyService.${call}(id, request);
    }
}`;

const dtosSrc = `namespace PnC.Api.DTOs;
public record EndorsePolicyRequest(decimal? PremiumAmount, string Reason);
public record CancelPolicyRequest(string Reason);
public record PolicyResponse();`;

test("a coherent four-file change passes with no findings (the false-positive guard)", () => {
  const r = checkCoherence(
    [sf(IFACE, ifaceSrc("EndorseAsync")), sf(IMPL, implSrc("EndorseAsync")), sf(CTRL, ctrlSrc("EndorseAsync")), sf(DTOS, dtosSrc)],
    repo,
  );
  assert.deepEqual(r.findings, [], `expected no findings, got: ${JSON.stringify(r.findings)}`);
  assert.equal(r.status, "passed");
  assert.equal(r.score, 1);
});

test("interface/impl rename mismatch → error, excluded via 'failed' status", () => {
  // Interface declares EndorseAsync; implementation renamed to ApplyEndorsementAsync.
  const r = checkCoherence(
    [sf(IFACE, ifaceSrc("EndorseAsync")), sf(IMPL, implSrc("ApplyEndorsementAsync")), sf(CTRL, ctrlSrc("EndorseAsync")), sf(DTOS, dtosSrc)],
    repo,
  );
  const impl = r.findings.filter((f) => f.check === "interface_impl" && f.severity === "error");
  assert.ok(impl.length >= 1, "expected an interface_impl error");
  assert.match(impl[0].message, /EndorseAsync/);
  assert.match(impl[0].message, /PolicyService/);
  assert.equal(r.status, "failed");
});

test("caller/callee mismatch → error (controller calls a method the interface doesn't declare)", () => {
  // Interface + impl agree on ApplyEndorsementAsync, but the controller calls EndorseAsync.
  const r = checkCoherence(
    [sf(IFACE, ifaceSrc("ApplyEndorsementAsync")), sf(IMPL, implSrc("ApplyEndorsementAsync")), sf(CTRL, ctrlSrc("EndorseAsync")), sf(DTOS, dtosSrc)],
    repo,
  );
  const cc = r.findings.filter((f) => f.check === "caller_callee" && f.severity === "error");
  assert.ok(cc.length >= 1, `expected a caller_callee error, got ${JSON.stringify(r.findings)}`);
  assert.match(cc[0].message, /EndorseAsync/);
  assert.match(cc[0].message, /IPolicyService/);
  assert.equal(cc[0].filePath, CTRL);
  assert.equal(r.status, "failed");
});

test("independent checks: a rename error AND a nonexistent-type warning both fire", () => {
  const r = checkCoherence(
    [
      sf(IFACE, ifaceSrc("EndorseAsync")),
      sf(IMPL, implSrc("ApplyEndorsementAsync")), // interface_impl error
      sf(CTRL, ctrlSrc("EndorseAsync", "private readonly NonExistentType _thing = new NonExistentType();")), // type_resolution warning
      sf(DTOS, dtosSrc),
    ],
    repo,
  );
  assert.ok(r.findings.some((f) => f.check === "interface_impl" && f.severity === "error"), "interface_impl error missing");
  assert.ok(r.findings.some((f) => f.check === "type_resolution" && /NonExistentType/.test(f.message)), "type_resolution warning missing");
});

test("a single-file suggestion always scores 1.0 with no findings", () => {
  const r = checkCoherence([sf(IMPL, implSrc("EndorseAsync"))], repo);
  assert.deepEqual(r.findings, []);
  assert.equal(r.score, 1);
  assert.equal(r.status, "passed");
});

test("interface method with no implementation in the repo → error (impl unchanged in repo)", () => {
  // The interface (changed) adds EndorseAsync; the implementation lives unchanged
  // in the repo WITHOUT that method.
  const repoWithStaleImpl = buildRepoSymbolIndex([
    { filePath: IMPL, content: `namespace PnC.Api.Services;\npublic class PolicyService : IPolicyService { public Task CancelAsync(int id, CancelPolicyRequest r) { return null; } }` },
  ]);
  const r = checkCoherence([sf(IFACE, ifaceSrc("EndorseAsync")), sf(DTOS, dtosSrc)], repoWithStaleImpl);
  assert.ok(r.findings.some((f) => f.check === "interface_impl" && f.severity === "error" && /EndorseAsync/.test(f.message)));
  assert.equal(r.status, "failed");
});

test("arity mismatch between interface and implementation → warning, not error", () => {
  const iface = `namespace PnC.Api.Services;
public interface IPolicyService
{
    Task<PolicyResponse?> EndorseAsync(int id, EndorsePolicyRequest request);
}`;
  const impl = `namespace PnC.Api.Services;
public class PolicyService : IPolicyService
{
    public Task<PolicyResponse?> EndorseAsync(int id)
    {
        return null;
    }
}`;
  const r = checkCoherence([sf(IFACE, iface), sf(IMPL, impl), sf(DTOS, dtosSrc)], repo);
  const w = r.findings.filter((f) => f.check === "interface_impl" && f.severity === "warning");
  assert.ok(w.length >= 1, "expected an arity warning");
  assert.equal(r.status, "warnings");
});

test("scoring: exactly one error → 0.75", () => {
  // Impl is missing EndorseAsync and has no orphan method → one error, no warning.
  const impl = `namespace PnC.Api.Services;
public class PolicyService : IPolicyService
{
    public Task<PolicyResponse?> CancelAsync(int id, CancelPolicyRequest request)
    {
        return null;
    }
}`;
  const r = checkCoherence([sf(IFACE, ifaceSrc("EndorseAsync")), sf(IMPL, impl), sf(DTOS, dtosSrc)], repo);
  assert.equal(r.findings.filter((f) => f.severity === "error").length, 1);
  assert.equal(r.findings.filter((f) => f.severity === "warning").length, 0);
  assert.equal(r.score, 0.75);
});

test("a rename fires both a missing-method error and an orphan-method warning", () => {
  const r = checkCoherence([sf(IFACE, ifaceSrc("EndorseAsync")), sf(IMPL, implSrc("ApplyEndorsementAsync")), sf(DTOS, dtosSrc)], repo);
  assert.equal(r.findings.filter((f) => f.severity === "error").length, 1); // EndorseAsync missing
  assert.ok(r.findings.some((f) => f.severity === "warning" && /ApplyEndorsementAsync/.test(f.message))); // orphan
  assert.equal(r.score, 0.65);
});

test("blind spots (primary constructor) are recorded as skips, not findings", () => {
  const primaryCtor = `namespace PnC.Api.Controllers;
using PnC.Api.Services;
public class PoliciesController(IPolicyService policyService)
{
    public Task<PolicyResponse?> Get(int id) { return policyService.EndorseAsync(id, null); }
}`;
  const r = checkCoherence([sf(IFACE, ifaceSrc("EndorseAsync")), sf(IMPL, implSrc("EndorseAsync")), sf(CTRL, primaryCtor), sf(DTOS, dtosSrc)], repo);
  assert.ok(r.skipped.some((s) => s.reason === "primary constructor"), "primary constructor should be recorded as a skip");
  // The call via the primary-ctor param is an unresolved receiver → skipped, not a false error.
  assert.ok(!r.findings.some((f) => f.check === "caller_callee"), "must not false-fire on a primary-ctor receiver");
});
