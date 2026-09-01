import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PR_TITLE_PREFIX, SECURITY_CHECK_CONTEXT } from "../../../../shared/types/branding.js";

/**
 * The prior brand must not come back into anything a customer's repository sees.
 *
 * These two strings land in someone else's GitHub: a pull request title, and a
 * commit status context their branch protection is configured against. A stray
 * reintroduction is not a cosmetic regression — it is a second, competing check
 * name that no rule is watching.
 */

const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

test("no prior-brand string survives in the API server", () => {
  const offenders = sourceFiles(API_SRC)
    .filter((f) => /blue[\s_-]?mantis/i.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(API_SRC, ""));
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} still carries the prior brand. Pull request titles and the ` +
      `security status context come from shared/types/branding.ts — nothing should spell them inline.`,
  );
});

test("the externally visible strings are the ones we intend", () => {
  // Pinned deliberately. Changing SECURITY_CHECK_CONTEXT breaks every branch
  // protection rule already configured against the old value, so it should not
  // change without someone editing this line on purpose.
  assert.equal(PR_TITLE_PREFIX, "[Kandryn]");
  assert.equal(SECURITY_CHECK_CONTEXT, "kandryn/security");
});
