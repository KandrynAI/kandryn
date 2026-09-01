import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One rule, one implementation.
 *
 * The resource-admin rule was written inline four separate times before it was
 * centralised, and each copy was a chance for one of them to drift from the
 * others — which is how a team-less user ended up with no path to administer a
 * resource only they could be responsible for. This guard fails the build if a
 * fifth inline copy appears.
 *
 * It deliberately does NOT flag `requireAdmin`, or a bare `teamRole === "admin"`
 * that guards a team-scoped collection (/reports/admin/*, /audit, /teams/*).
 * Those ask a different question and are correct as they stand. What it flags is
 * the resource-shaped form: a role check combined, in the same expression, with
 * a comparison against a resource's own team id.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The one implementation, plus the tests that exercise it. */
const ALLOWED = new Set(["services/resourceAdmin.ts"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") sourceFiles(full, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments describing the pattern must not trip the guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC).map((full) => ({
  rel: relative(SRC, full).split(sep).join("/"),
  text: stripComments(readFileSync(full, "utf8")),
}));

test("the source tree is non-empty (the guard is actually reading files)", () => {
  assert.ok(files.length > 20, `expected the api-server sources, found ${files.length} files`);
});

test("only resourceAdmin.ts decides who may administer a resource", () => {
  // An admin-role check AND a team-to-team comparison within ~120 chars of each
  // other, in either order.
  //
  // RESOURCE_TEAM matches ANY `x.teamId === y.teamId`, not just the two operand
  // names projects.ts happened to use. The first version of this rule pinned the
  // right-hand side to `req.teamId`/`actor.teamId` and sailed straight past
  // `actor.teamId === target.project?.teamId` — the same rule, written the other
  // way round. A guard that only recognises the copy it was written from is not
  // a guard.
  //
  // A collection gate compares a caller's team to a literal or to nothing at
  // all, so it has no second `.teamId` to match and stays clear of this.
  const ROLE = `teamRole\\s*[!=]==\\s*"admin"`;
  const RESOURCE_TEAM = `\\.teamId\\s*[!=]==\\s*[A-Za-z_$][\\w$.?]*\\.teamId`;
  const INLINE_RULE = new RegExp(`(${ROLE}[\\s\\S]{0,120}${RESOURCE_TEAM})|(${RESOURCE_TEAM}[\\s\\S]{0,120}${ROLE})`);

  const offenders = files
    .filter((f) => INLINE_RULE.test(f.text))
    .map((f) => f.rel)
    .filter((rel) => !ALLOWED.has(rel));

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} decides resource administration inline. Call canAdminister() from ` +
      `services/resourceAdmin.ts instead — four hand-written copies of this rule is how a team-less ` +
      `owner ended up locked out of their own resource. requireAdmin remains correct for team-scoped ` +
      `collections and is not what this checks.`,
  );
});

test("the security-gate override is not double-gated by requireAdmin", () => {
  // The policy function is the sole authority: it is resource-aware, and it is
  // what the GET publishes to the client. A middleware on the POST would make
  // enforcement stricter than the advertised policy.
  const runs = files.find((f) => f.rel === "routes/runs.ts");
  assert.ok(runs, "routes/runs.ts not found");
  assert.ok(
    !/requireAdmin/.test(runs.text),
    "routes/runs.ts re-introduced requireAdmin. The override route must be gated by " +
      "overrideSecurityGate's own policy, which the GET endpoint also publishes.",
  );
});
