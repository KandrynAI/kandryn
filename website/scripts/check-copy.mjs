#!/usr/bin/env node
/**
 * check:copy. The regression guard for two marketing-site copy rules.
 *
 *   1. Marketing copy names no AI vendor or model. Legal and trust disclosures
 *      still do, deliberately, so each of those lines is listed in
 *      scripts/copy-allowlist.json with the reason it is kept.
 *   2. No NEW em dash is added to lib/site.ts. The existing ones are left alone
 *      by instruction, so the check is a ceiling rather than a ban: the count
 *      may not rise above the baseline recorded in the allowlist file.
 *
 * Reads files only. Makes no network call. No dependencies. Not wired into the
 * build: run it with `npm run check:copy`.
 *
 * Exit 0 = clean. Exit 1 = violations, printed with file, line and sentence.
 * Exit 2 = the check itself could not run (bad allowlist, missing baseline file).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'copy-allowlist.json');

/**
 * The banned terms, as anchored regexes.
 *
 * Anchored on word boundaries so `opus` does not fire on "corpus" and `grok`
 * does not fire on "grokking". Case-insensitive, because the point is to catch
 * a name however it was typed.
 */
const BANNED = [
  /\bclaude\b/i,
  /\banthropic\b/i,
  /\bopen\s?ai\b/i,
  /\bchatgpt\b/i,
  /\bgpt(-[\w.]+)?\b/i,
  /\bsonnet\b/i,
  /\bopus\b/i,
  /\bhaiku\b/i,
  /\bfable\b/i,
  /\bgemini\b/i,
  /\bmistral\b/i,
  /\bllama\b/i,
  /\bbedrock\b/i,
  /\bvertex\s+ai\b/i,
  /\bdeepseek\b/i,
  /\bgrok\b/i,
  /\bllms?\b/i,
  /\bfrontier\s+model/i,
  /\bfoundation\s+model/i,
];

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.txt', '.md', '.svg', '.json'];

/** Build output, dependencies, the lockfile, and this check's own two files. */
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', '.git', '.vercel']);
const SKIP_FILES = new Set([
  join('package-lock.json'),
  join('scripts', 'check-copy.mjs'),
  join('scripts', 'copy-allowlist.json'),
]);

function loadAllowlist() {
  let raw;
  try {
    raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  } catch {
    console.error(`check:copy cannot run: ${relative(ROOT, ALLOWLIST_PATH)} is missing.`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`check:copy cannot run: ${relative(ROOT, ALLOWLIST_PATH)} is not valid JSON. ${err.message}`);
    process.exit(2);
  }
  const keep = Array.isArray(parsed.keep) ? parsed.keep : [];
  for (const entry of keep) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.line !== 'string' || typeof entry.reason !== 'string') {
      console.error('check:copy cannot run: every "keep" entry needs file, line and reason strings.');
      process.exit(2);
    }
  }
  return { keep, emDashBaseline: parsed.emDashBaseline ?? {} };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!SCAN_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    const rel = relative(ROOT, full);
    if (SKIP_FILES.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

/**
 * A hit is allowed when an allowlist entry names the same file AND its `line`
 * substring appears on the hit line. Matching on a substring rather than a line
 * NUMBER is deliberate: a line number goes stale on the next edit above it, and
 * a stale allowlist silently stops guarding.
 */
function allowed(keep, file, text) {
  const posix = file.split(sep).join('/');
  return keep.some((entry) => entry.file === posix && text.includes(entry.line));
}

function main() {
  const { keep, emDashBaseline } = loadAllowlist();
  const files = walk(ROOT);
  const violations = [];

  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    lines.forEach((text, i) => {
      const term = BANNED.find((re) => re.test(text));
      if (!term) return;
      if (allowed(keep, file, text)) return;
      violations.push({ file, line: i + 1, text: text.trim(), term: String(term) });
    });
  }

  // Em dash ceiling. Not a ban: the pre-existing ones stay by instruction.
  const overBaseline = [];
  for (const [file, baseline] of Object.entries(emDashBaseline)) {
    let count;
    try {
      count = (readFileSync(join(ROOT, file), 'utf8').match(/—/g) ?? []).length;
    } catch {
      console.error(`check:copy cannot run: ${file} has an em dash baseline but does not exist.`);
      process.exit(2);
    }
    if (count > baseline) overBaseline.push({ file, baseline, count });
  }

  if (violations.length === 0 && overBaseline.length === 0) {
    console.log(`check:copy: clean. ${files.length} files scanned, ${keep.length} disclosure lines allowlisted.`);
    return;
  }

  for (const v of violations) {
    console.error(`${v.file}:${v.line}  banned term ${v.term}\n    ${v.text}`);
  }
  for (const o of overBaseline) {
    console.error(
      `${o.file}  em dashes rose to ${o.count}, baseline is ${o.baseline}. Remove the new one, or lower the baseline if you removed others.`,
    );
  }
  console.error(
    `\ncheck:copy FAILED: ${violations.length} banned term(s), ${overBaseline.length} em dash regression(s).`,
  );
  process.exit(1);
}

main();
