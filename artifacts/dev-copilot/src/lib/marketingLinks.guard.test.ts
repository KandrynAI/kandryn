import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A link from the app to a marketing page must be absolute.
 *
 * The app is app.kandryn.com; the marketing site is kandryn.com. A
 * root-relative href="/contact/" therefore resolves against the app's own
 * origin, matches no route, falls through to the authenticated catch-all, and
 * Clerk bounces the visitor to /sign-in?redirect_url=… Someone who has no
 * account — the only person who ever clicks "Request access" — is sent to the
 * one page they cannot use.
 *
 * That shipped twice independently: the sign-in page's "Request access" link
 * and the audit tab's "Upgrade" link. Both read as obviously correct. Nothing
 * in the type system or the router objects, and it cannot be caught by opening
 * the page while signed in, because a signed-in session never sees the bounce.
 *
 * So the rule is enforced here rather than remembered. Use marketingUrl().
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Paths served by the marketing site, not by this app. */
const MARKETING_PATHS = [
  "contact",
  "trust",
  "privacy",
  "terms",
  "how-it-works",
  "integrations",
  "resources",
  "faq",
  "security",
];

/** href="/contact/" and friends — root-relative, so app-origin. */
const BAD_HREF = new RegExp(
  `href\\s*=\\s*["'\`]/(?:${MARKETING_PATHS.join("|")})(?:/|["'\`])`,
);

/** This file names the paths deliberately; marketing.ts defines the escape hatch. */
const EXEMPT = new Set(["lib/marketingLinks.guard.test.ts", "lib/marketing.ts"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("no root-relative links to marketing pages", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (EXEMPT.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      if (BAD_HREF.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `These link to a marketing page using a path relative to the app's own origin, ` +
      `which dead-ends at sign-in for anonymous visitors. Use marketingUrl("/path/") ` +
      `from @/lib/marketing instead:\n  ${offenders.join("\n  ")}`,
  );
});
