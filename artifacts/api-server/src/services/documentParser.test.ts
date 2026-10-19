import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CHUNK_MAX_TOKENS,
  DocumentParseError,
  containsPrivateKey,
  docxHtmlToMarkdown,
  estimateTokens,
  parseDocument,
  sniffKind,
  splitMarkdownSections,
} from "./documentParser.js";

/**
 * The parser, the chunker and the two refusals, with no storage and no
 * database in the loop.
 *
 * The fixtures are hand-built and the content is invented — nothing here came
 * from a customer document.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const buf = (name: string) => readFileSync(join(FIXTURES, name));

const MD = `# Claims Platform

Overview of the claims service.

## Policy validation

A claim may only be settled when an active policy exists for the claim date.

### Effective dates

A policy is active between its effective and expiry dates.

## Billing

Invoices are raised monthly.
`;

test("1. markdown keeps the heading path and stays under the chunk maximum", async () => {
  const { chunks } = await parseDocument(Buffer.from(MD, "utf8"), "requirements.md");
  const headings = chunks.map((c) => c.heading);
  assert.ok(headings.includes("Claims Platform"), `got ${JSON.stringify(headings)}`);
  assert.ok(headings.includes("Claims Platform > Policy validation"));
  assert.ok(
    headings.includes("Claims Platform > Policy validation > Effective dates"),
    "a nested heading carries its whole path, not just the leaf",
  );
  // A sibling at depth 2 must drop the depth-3 segment, not inherit it.
  assert.ok(headings.includes("Claims Platform > Billing"));
  for (const c of chunks) assert.ok(estimateTokens(c.text) <= CHUNK_MAX_TOKENS);
});

test("2. a very long single paragraph is split, never over the maximum, nothing lost", async () => {
  // One paragraph, no headings, no blank lines: the chunker has only its own
  // window to fall back on.
  const words = Array.from({ length: 4000 }, (_, i) => `word${i}`);
  const long = words.join(" ");
  const { chunks } = await parseDocument(Buffer.from(`# Long\n\n${long}\n`, "utf8"), "long.md");

  assert.ok(chunks.length > 1, "a 4000-word paragraph must be split");
  for (const c of chunks) {
    assert.ok(estimateTokens(c.text) <= CHUNK_MAX_TOKENS, `chunk of ${estimateTokens(c.text)} tokens`);
  }
  // Nothing lost: every word survives somewhere, first and last included.
  const joined = chunks.map((c) => c.text).join(" ");
  for (const w of ["word0", "word1999", "word3999"]) {
    assert.ok(joined.includes(w), `${w} was dropped`);
  }
  // seq is dense and ordered, since (source_id, seq) is a unique key.
  assert.deepEqual(
    chunks.map((c) => c.seq),
    chunks.map((_, i) => i),
  );
});

test("3. an empty document yields no chunks and a clear message", async () => {
  await assert.rejects(
    () => parseDocument(Buffer.from("   \n\n  \n", "utf8"), "empty.md"),
    (err: unknown) => {
      assert.ok(err instanceof DocumentParseError);
      assert.match((err as Error).message, /No readable text/);
      return true;
    },
  );
});

test("4. the magic-byte check rejects a file renamed to .pdf", () => {
  const notAPdf = Buffer.from("MZ\u0090\u0000\u0003", "latin1"); // a PE header
  assert.throws(() => sniffKind(notAPdf, "architecture.pdf"), /not a PDF/);
  // And the same trick the other way: a real PDF renamed to .txt.
  assert.throws(() => sniffKind(buf("sample.pdf"), "notes.txt"), /not a text document/);
  // A docx renamed to .pdf is a zip, so it fails the pdf check too.
  assert.throws(() => sniffKind(buf("sample.docx"), "spec.pdf"), /not a PDF/);
  // An unknown extension is refused before any parser sees it.
  assert.throws(() => sniffKind(Buffer.from("anything"), "payload.exe"), /Unsupported file type/);
  // The real files still pass.
  assert.equal(sniffKind(buf("sample.pdf"), "a.pdf"), "pdf");
  assert.equal(sniffKind(buf("sample.docx"), "a.docx"), "docx");
  assert.equal(sniffKind(Buffer.from(MD, "utf8"), "a.md"), "md");
});

test("5. a private key block is rejected without echoing the match", async () => {
  const withKey = `# Deployment\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEugIBADANBg\n-----END RSA PRIVATE KEY-----\n`;
  assert.equal(containsPrivateKey(withKey), true);
  assert.equal(containsPrivateKey("# Deployment\n\nNo secrets here."), false);

  await assert.rejects(
    () => parseDocument(Buffer.from(withKey, "utf8"), "deploy.md"),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.match(msg, /private key/i);
      assert.ok(!msg.includes("MIIEugIBADANBg"), "the message must not echo the key material");
      assert.ok(!msg.includes("BEGIN RSA"), "the message must not echo the match");
      return true;
    },
  );
});

test("a pdf chunk carries its page number and a md chunk does not", async () => {
  const { chunks } = await parseDocument(buf("sample.pdf"), "architecture.pdf");
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].page, 1);
  assert.match(chunks[0].text, /retention policy/);

  const md = await parseDocument(Buffer.from(MD, "utf8"), "a.md");
  assert.equal(md.chunks[0].page, null);
});

test("docx headings survive the conversion to markdown", async () => {
  const { chunks } = await parseDocument(buf("sample.docx"), "platform.docx");
  const headings = chunks.map((c) => c.heading);
  assert.ok(headings.includes("Claims Platform > Policy validation"), `got ${JSON.stringify(headings)}`);
  assert.match(chunks.map((c) => c.text).join("\n"), /active policy exists/);
});

test("the html-to-markdown step keeps headings, bullets and entities", () => {
  const md = docxHtmlToMarkdown(
    "<h1>Billing &amp; Claims</h1><p>First.</p><ul><li>One</li><li>Two</li></ul><h2>Rates</h2><p>Second.</p>",
  );
  assert.match(md, /^# Billing & Claims$/m);
  assert.match(md, /^## Rates$/m);
  assert.match(md, /^- One$/m);
  assert.ok(!md.includes("<"), `tags remained: ${md}`);
  // And the result is something splitMarkdownSections can actually read.
  const sections = splitMarkdownSections(md);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["Billing & Claims", "Billing & Claims > Rates"],
  );
});

test("csv windows repeat the header row so a chunk is readable alone", async () => {
  const rows = Array.from({ length: 400 }, (_, i) => `${i},policy-${i},active`).join("\n");
  const { chunks } = await parseDocument(Buffer.from(`id,name,status\n${rows}\n`, "utf8"), "policies.csv");
  assert.ok(chunks.length > 1, "400 rows must span more than one chunk");
  for (const c of chunks) {
    assert.match(c.text, /^id,name,status/, "every csv chunk starts with the header row");
    assert.ok(estimateTokens(c.text) <= CHUNK_MAX_TOKENS);
  }
});
