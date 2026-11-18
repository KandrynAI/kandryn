import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// From the db-free module, so this test needs no DATABASE_URL.
import {
  gitWriteRefusal,
  NO_GIT_CREDS_MESSAGE_ADMIN,
  NO_GIT_CREDS_MESSAGE_MEMBER,
} from "./gitCredsCore.js";

/**
 * A git write never happens without a credential.
 *
 * `noGitCredsMessage` shipped with 0046 and was called by NOTHING. So every
 * write path built an unauthenticated client and let the provider answer, and
 * GitHub answers 404 for a repository an anonymous caller cannot see. On run
 * #42 a customer saw "Not Found" and a link to the documentation about git
 * refs, for a problem that was entirely about credentials; the giveaway was
 * `x-ratelimit-limit: 60` in the response, GitHub's anonymous ceiling.
 *
 * An exported message with no callers is not a safeguard, and nothing in the
 * type system notices. This guard does.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The provider calls that change a customer's repository. */
const WRITES = ["createBranch", "commitChanges", "createPullRequest"];

/**
 * Files that write without checking, each with the reason.
 *
 * `narratiaPushService.ts` is a best-effort push whose documented contract is
 * to return null on any failure, and whose caller already handles null so the
 * runbook still saves. Its own try/catch swallows the refusal and logs it.
 * Adding a throw there would turn a deliberately non-fatal path fatal for no
 * user-visible gain.
 */
const ALLOWLIST = new Map<string, string>([
  ["services/narratiaPushService.ts", "best-effort push; returns null on failure by contract"],
]);

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

/** The comments above name the banned shape; they must not trip the guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC)
  .map((full) => ({
    rel: relative(SRC, full).split(sep).join("/"),
    code: stripComments(readFileSync(full, "utf8")),
  }))
  // gitService.ts DECLARES these methods; it is not a call site.
  .filter(
    (f) =>
      f.rel !== "services/gitService.ts" &&
      f.rel !== "services/gitCredsCore.ts" &&
      !f.rel.startsWith("adapters/"),
  );

test("guard: the write call sites were found to scan", () => {
  // Without this the assertion below passes on an empty list and says nothing.
  const writers = files.filter(({ code }) =>
    WRITES.some((w) => new RegExp(`\\.${w}\\s*\\(`).test(code)),
  );
  assert.ok(
    writers.length >= 4,
    `expected at least four files writing to a git provider, found ${writers.length}`,
  );
});

test("every file that writes to a git provider refuses without a credential", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    const writes = WRITES.some((w) => new RegExp(`\\.${w}\\s*\\(`).test(code));
    if (!writes) continue;
    if (ALLOWLIST.has(rel)) continue;
    if (!code.includes("gitWriteRefusal")) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `These files write to a customer's repository without checking that a credential exists.\n` +
      `An unauthenticated client makes the provider answer 404, which reads as a missing branch\n` +
      `rather than a missing credential. Call gitWriteRefusal first, or allowlist with a reason.\n` +
      offenders.join("\n"),
  );
});

test("the allowlist names a reason for every entry", () => {
  for (const [file, reason] of ALLOWLIST) {
    assert.ok(reason.length > 20, `${file} needs a real reason, not "${reason}"`);
    assert.ok(
      files.some((f) => f.rel === file),
      `${file} is allowlisted but no longer exists — remove the entry`,
    );
  }
});

// --- the refusal itself -----------------------------------------------------

const none = { githubToken: undefined, azureReposToken: undefined };

test("a write with no credential is refused, per provider", () => {
  assert.ok(gitWriteRefusal(none, "github", true));
  assert.ok(gitWriteRefusal(none, "azure-repos", true));
});

test("a token for the OTHER provider does not unblock a write", () => {
  // An Azure Repos repository is not reachable with a GitHub token, and
  // reporting it as fine would send someone looking in the wrong place.
  assert.ok(gitWriteRefusal({ githubToken: "ghp_x", azureReposToken: undefined }, "azure-repos", true));
  assert.ok(gitWriteRefusal({ githubToken: undefined, azureReposToken: "az_x" }, "github", true));
});

test("the right token allows the write", () => {
  assert.equal(gitWriteRefusal({ githubToken: "ghp_x", azureReposToken: undefined }, "github", true), null);
  assert.equal(
    gitWriteRefusal({ githubToken: undefined, azureReposToken: "az_x" }, "azure-repos", true),
    null,
  );
});

test("the refusal names the provider and the remedy, split by audience", () => {
  const forAdmin = gitWriteRefusal(none, "github", true)!;
  const forMember = gitWriteRefusal(none, "github", false)!;
  assert.match(forAdmin, /GitHub/);
  assert.ok(forAdmin.includes(NO_GIT_CREDS_MESSAGE_ADMIN), "an admin is told where to add it");
  assert.ok(forMember.includes(NO_GIT_CREDS_MESSAGE_MEMBER), "a member is told who to ask");
  assert.notEqual(forAdmin, forMember);
  assert.match(gitWriteRefusal(none, "azure-repos", true)!, /Azure Repos/);
});

test("the refusal carries no credential and no provider URL", () => {
  // It reaches a toast. A 404 body with a documentation link is what this
  // replaces; leaking a token fragment would be worse than either.
  for (const isAdmin of [true, false]) {
    const msg = gitWriteRefusal({ githubToken: undefined, azureReposToken: "az_secret_value" }, "github", isAdmin)!;
    assert.ok(!msg.includes("az_secret_value"));
    assert.ok(!/https?:\/\//.test(msg));
  }
});
