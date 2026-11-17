import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP_INTRO, HELP_SECTIONS, QUICK_START, type HelpSection } from "./content.ts";

/**
 * The guide's three rules, enforced rather than trusted.
 *
 * A help page rots differently from other code: nothing breaks when a button is
 * renamed, the guide simply starts lying, and the first person to notice is a
 * new user who has no way to tell the guide from the product. So the labels are
 * checked against the source tree on every run.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
/** Strings Kandryn stamps on a customer's repository. Not dev-copilot's to own. */
const BRANDING = join(SRC, "..", "..", "..", "shared", "types", "branding.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !full.includes(`${join("src", "help")}`)) {
      out.push(full);
    }
  }
  return out;
}

const APP_SOURCE = sourceFiles(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
const BRANDING_SOURCE = readFileSync(BRANDING, "utf8");

/**
 * Quoted strings that are genuinely on screen but are not literals in this
 * app's source. Each needs a reason, the way the marketing site's copy
 * allowlist does: an unexplained entry here is how a guard quietly stops
 * guarding.
 */
const LABEL_ALLOWLIST: Record<string, string> = {
  ADMIN: "ContextPanel renders the role through textTransform: uppercase, so the literal is \"admin\".",
  MEMBER: "Same uppercase transform on the role badge.",
  "Approve & generate": "run-detail.tsx writes the ampersand as the JSX entity &amp;.",
  "Repository needs reconfiguration": "Server string from the API's repository resolver, surfaced on the run.",
  "No agent produced a suggestion.": "Server string thrown by the run service when both agents fail.",
  "Run timed out": "Server string written by the dispatcher's stuck-run sweep.",
  "Run was never started": "Server string written by the dispatcher's stranded-run sweep.",
  "Add your Raptia and Fovea credentials in Settings, or choose Use Kandryn Agents.":
    "Server string (NO_MODEL_KEY_MESSAGE in services/modelKey.ts), returned by every path that needs a model credential.",
};

/** Everything a reader can see, as flat strings. */
function visibleStrings(): string[] {
  const out: string[] = [HELP_INTRO, ...QUICK_START];
  for (const s of HELP_SECTIONS) {
    out.push(s.title);
    if (s.intro) out.push(s.intro);
    if (s.where) out.push(s.where.label);
    if (s.steps) out.push(...s.steps);
    if (s.watchFor) out.push(s.watchFor);
    if (s.troubles) for (const t of s.troubles) out.push(t.message, t.meaning, t.fix);
    if (s.terms) for (const t of s.terms) out.push(t.term, t.definition);
  }
  return out;
}

test("the guard has content to check", () => {
  // Without this every assertion below passes on an empty list and proves nothing.
  assert.ok(HELP_SECTIONS.length >= 10, `expected a full guide, found ${HELP_SECTIONS.length} sections`);
  assert.ok(visibleStrings().length > 100);
  assert.ok(APP_SOURCE.includes("Run agents"), "the app source was not read");
});

test("every quoted label exists on screen, verbatim", () => {
  const misses: string[] = [];
  for (const text of visibleStrings()) {
    for (const match of text.matchAll(/"([^"]+)"/g)) {
      const label = match[1];
      if (label in LABEL_ALLOWLIST) continue;
      if (APP_SOURCE.includes(label) || BRANDING_SOURCE.includes(label)) continue;
      misses.push(label);
    }
  }
  assert.deepEqual(
    misses,
    [],
    `The guide quotes labels that are nowhere in the app. Either the screen changed and the guide must follow, or the quote is wrong:\n${misses.map((m) => `  ${JSON.stringify(m)}`).join("\n")}`,
  );
});

test("no model vendor or model name reaches the copy", () => {
  // The product says Raptia, Fovea, Synthesia, Veria, Aegis, Narratia, Kandryn.
  const banned = [
    /\bclaude\b/i, /\banthropic\b/i, /\bopen\s?ai\b/i, /\bchatgpt\b/i,
    /\bgpt(-[\w.]+)?\b/i, /\bsonnet\b/i, /\bopus\b/i, /\bhaiku\b/i, /\bfable\b/i,
    /\bgemini\b/i, /\bmistral\b/i, /\bllama\b/i, /\bbedrock\b/i, /\bdeepseek\b/i,
    /\bgrok\b/i, /\bllms?\b/i,
  ];
  const hits: string[] = [];
  for (const text of visibleStrings()) {
    for (const re of banned) if (re.test(text)) hits.push(`${re} in: ${text}`);
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("no em dash", () => {
  const hits = visibleStrings().filter((t) => t.includes("—"));
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("no plan, price or limit talk", () => {
  const banned = [/\bpricing\b/i, /\bper seat\b/i, /\bfree tier\b/i, /\bupgrade your plan\b/i, /\bsubscription\b/i, /\$\d/];
  const hits: string[] = [];
  for (const text of visibleStrings()) {
    for (const re of banned) if (re.test(text)) hits.push(`${re} in: ${text}`);
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("section ids are unique and anchor-safe", () => {
  const ids = HELP_SECTIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate section id");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/, `unusable anchor id: ${id}`);
  assert.ok(!ids.includes("quick-start"), "quick-start is the standalone block's id and cannot be reused");
});

/**
 * Route patterns declared in App.tsx, as regexes over the path. Kept here
 * rather than parsed out of App.tsx: a parser that silently matches nothing
 * would make this test pass on a broken link, which is the failure it exists
 * to catch.
 */
const ROUTES = [
  /^\/dashboard$/,
  /^\/projects\/new$/,
  /^\/p\/\{projectId\}\/board$/,
  /^\/p\/\{projectId\}\/runs$/,
  /^\/p\/\{projectId\}\/settings$/,
  /^\/repositories$/,
  /^\/reports$/,
  /^\/history$/,
  /^\/settings$/,
  /^\/help$/,
];

test("every Where you are link points at a declared route", () => {
  const bad: string[] = [];
  for (const s of HELP_SECTIONS) {
    if (!s.where) continue;
    const path = s.where.href.split("?")[0];
    if (!ROUTES.some((r) => r.test(path))) bad.push(`${s.id}: ${s.where.href}`);
  }
  assert.deepEqual(bad, [], `links with no matching route in App.tsx:\n${bad.join("\n")}`);
});

test("a section with a where link names the screen it opens", () => {
  for (const s of HELP_SECTIONS) {
    if (!s.where) continue;
    assert.ok(s.where.label.trim().length > 0, `${s.id} has a link with no label`);
  }
});

test("only sections that are genuinely admin-only carry the Admin tag", () => {
  // Audit log is admin-gated in AuditTab.tsx; nothing else in this guide is a
  // wholly admin screen (Reports gates two sub-views, explained in its steps).
  const tagged = HELP_SECTIONS.filter((s: HelpSection) => s.admin).map((s) => s.id);
  assert.deepEqual(tagged, ["audit"]);
});

test("the quick start is the short path, not a second guide", () => {
  assert.ok(QUICK_START.length <= 8, `quick start grew to ${QUICK_START.length} steps`);
});
