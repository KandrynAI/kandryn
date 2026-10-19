/**
 * Turn an uploaded document into retrievable passages (0041).
 *
 * The file-type sniffing, the secret check and the chunker are pure and
 * synchronous; only the pdf and docx extractors need a library, and they are
 * imported lazily so a markdown upload never pays for a PDF engine.
 *
 * Two rules the whole file follows:
 *  - The real type is decided by MAGIC BYTES, never by the extension or the
 *    client's mime type. A .exe renamed to .pdf must not reach a parser.
 *  - Document text appears in exactly one place: the chunks this module
 *    returns, which the caller writes to knowledge_chunks. It is never logged,
 *    never put on the source row, and never echoed in an error.
 */

/** Chunk sizing, in the same crude token estimate the context pack uses. */
export const CHUNK_TARGET_TOKENS = 600;
export const CHUNK_MAX_TOKENS = 900;
/** Beyond this a document is indexed partially and the source row says so. */
export const MAX_CHUNKS_PER_DOCUMENT = 400;

const CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * 4;
const CHUNK_MAX_CHARS = CHUNK_MAX_TOKENS * 4;
/** Overlap for pdf windows only — page text has no headings to anchor on. */
const PDF_OVERLAP_CHARS = 200;

export type DocumentKind = "md" | "txt" | "csv" | "pdf" | "docx";

export interface ParsedChunk {
  seq: number;
  heading: string | null;
  page: number | null;
  text: string;
}

export interface ParseResult {
  chunks: ParsedChunk[];
  /** Set when the document was indexed only in part. Safe to store and show. */
  warning: string | null;
}

export class DocumentParseError extends Error {}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Type sniffing and the secret check
// ---------------------------------------------------------------------------

const PDF_MAGIC = Buffer.from("%PDF-");
// docx is a zip. "PK\x03\x04" is a local file header; the other two are an
// empty and a spanned archive, which a real docx never is but which identify
// the container all the same.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * The document's REAL kind, from its bytes plus the declared extension for
 * the text formats (which have no magic of their own).
 *
 * Throws when the bytes contradict the extension — a renamed executable, a zip
 * claiming to be a pdf — because that is the case the extension check cannot
 * see and the one worth refusing loudly.
 */
export function sniffKind(bytes: Buffer, fileName: string): DocumentKind {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const isPdf = bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
  const isZip = bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);

  if (ext === "pdf") {
    if (!isPdf) throw new DocumentParseError("That file is not a PDF. Upload the real document.");
    return "pdf";
  }
  if (ext === "docx") {
    if (!isZip) throw new DocumentParseError("That file is not a Word document. Upload the real document.");
    return "docx";
  }
  if (ext === "md" || ext === "txt" || ext === "csv") {
    // A binary container renamed to .txt is the same trick in the other
    // direction: text formats must not carry a pdf or zip payload.
    if (isPdf || isZip) throw new DocumentParseError("That file is not a text document. Upload the real document.");
    if (containsControlBytes(bytes)) {
      throw new DocumentParseError("That file is not a text document. Upload the real document.");
    }
    return ext;
  }
  throw new DocumentParseError("Unsupported file type. Upload a .md, .txt, .csv, .pdf or .docx file.");
}

/** NUL and most C0 controls never occur in a text document. */
function containsControlBytes(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 8192);
  for (const b of head) {
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) return true;
  }
  return false;
}

const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

/**
 * Whether the text carries a private key block. The caller refuses the upload
 * and deletes the object; it never echoes what matched, because the match IS
 * the secret.
 */
export function containsPrivateKey(text: string): boolean {
  return PRIVATE_KEY_BLOCK.test(text);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Split text that has no structure to respect, at paragraph then line then hard cut. */
function splitLong(text: string, maxChars: number, overlap = 0): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    // Prefer a paragraph break, then a line break, then a space, inside the
    // window. A hard cut is the last resort and still never loses a character.
    const window = rest.slice(0, maxChars);
    let cut = window.lastIndexOf("\n\n");
    if (cut < maxChars * 0.5) cut = window.lastIndexOf("\n");
    if (cut < maxChars * 0.5) cut = window.lastIndexOf(" ");
    if (cut < maxChars * 0.5) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = overlap > 0 ? rest.slice(Math.max(0, cut - overlap)) : rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out.filter(Boolean);
}

interface Section {
  heading: string | null;
  text: string;
}

/**
 * Split markdown on ATX headings, carrying the heading PATH ("Architecture >
 * Billing") rather than the leaf, so a chunk retrieved on its own still says
 * where in the document it came from.
 */
export function splitMarkdownSections(md: string): Section[] {
  const lines = md.split(/\r?\n/);
  const sections: Section[] = [];
  const path: string[] = [];
  let buffer: string[] = [];
  let heading: string | null = null;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ heading, text });
    buffer = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!m) {
      buffer.push(line);
      continue;
    }
    flush();
    const depth = m[1].length;
    path.length = Math.min(path.length, depth - 1);
    path[depth - 1] = m[2].trim();
    heading = path.filter(Boolean).join(" > ");
  }
  flush();
  return sections;
}

/** Group CSV rows into windows, repeating the header row for context. */
function csvSections(text: string): Section[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0];
  const body = lines.slice(1);
  if (body.length === 0) return [{ heading: null, text: header }];

  const sections: Section[] = [];
  let group: string[] = [];
  let size = header.length;
  for (const row of body) {
    if (size + row.length > CHUNK_TARGET_CHARS && group.length > 0) {
      sections.push({ heading: null, text: [header, ...group].join("\n") });
      group = [];
      size = header.length;
    }
    group.push(row);
    size += row.length + 1;
  }
  if (group.length > 0) sections.push({ heading: null, text: [header, ...group].join("\n") });
  return sections;
}

/**
 * Pack sections into chunks: merge small adjacent sections up to the target,
 * split any that exceed the maximum, drop the empties.
 */
function chunksFromSections(sections: Section[], page: number | null = null, overlap = 0): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let pending: Section | null = null;

  const push = (heading: string | null, text: string) => {
    const t = text.trim();
    if (t) chunks.push({ seq: chunks.length, heading, page, text: t });
  };

  for (const section of sections) {
    if (!section.text.trim()) continue;

    if (section.text.length > CHUNK_MAX_CHARS) {
      if (pending) {
        push(pending.heading, pending.text);
        pending = null;
      }
      for (const part of splitLong(section.text, CHUNK_MAX_CHARS, overlap)) push(section.heading, part);
      continue;
    }

    // Merge only sections that share a heading; a merged chunk otherwise gets
    // a heading that describes half of it.
    if (
      pending &&
      pending.heading === section.heading &&
      pending.text.length + section.text.length + 2 <= CHUNK_TARGET_CHARS
    ) {
      pending = { heading: pending.heading, text: `${pending.text}\n\n${section.text}` };
      continue;
    }
    if (pending) push(pending.heading, pending.text);
    pending = section;
  }
  if (pending) push(pending.heading, pending.text);
  return chunks;
}

function capped(chunks: ParsedChunk[]): ParseResult {
  if (chunks.length <= MAX_CHUNKS_PER_DOCUMENT) return { chunks, warning: null };
  return {
    chunks: chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT).map((c, i) => ({ ...c, seq: i })),
    warning: "Document too large to index fully",
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse and chunk a document. Throws DocumentParseError with a message that is
 * safe to show and to store: it names the problem, never a fragment of the
 * file.
 */
export async function parseDocument(bytes: Buffer, fileName: string): Promise<ParseResult> {
  const kind = sniffKind(bytes, fileName);

  if (kind === "pdf") {
    const pages = await extractPdfPages(bytes);
    const all: ParsedChunk[] = [];
    pages.forEach((pageText, i) => {
      if (containsPrivateKey(pageText)) throw privateKeyError();
      const sections = pageText.trim() ? [{ heading: null, text: pageText }] : [];
      for (const c of chunksFromSections(sections, i + 1, PDF_OVERLAP_CHARS)) {
        all.push({ ...c, seq: all.length });
      }
    });
    return finish(all, fileName);
  }

  const text = kind === "docx" ? await extractDocxMarkdown(bytes) : bytes.toString("utf8");
  if (containsPrivateKey(text)) throw privateKeyError();

  const sections = kind === "csv" ? csvSections(text) : splitMarkdownSections(text);
  return finish(chunksFromSections(sections), fileName);
}

function privateKeyError(): DocumentParseError {
  // Deliberately says nothing about where or what matched.
  return new DocumentParseError(
    "That document appears to contain a private key. It was not stored. Remove the credential and upload it again.",
  );
}

function finish(chunks: ParsedChunk[], _fileName: string): ParseResult {
  if (chunks.length === 0) {
    throw new DocumentParseError("No readable text was found in that document.");
  }
  return capped(chunks);
}

// ---------------------------------------------------------------------------
// Library-backed extractors, imported lazily
// ---------------------------------------------------------------------------

async function extractPdfPages(bytes: Buffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text : [String(text)];
  } catch {
    // The library's own error can quote file content; ours cannot.
    throw new DocumentParseError("That PDF could not be read. It may be encrypted or damaged.");
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Enough of mammoth's HTML turned into markdown for the chunker's purposes:
 * headings become ATX so splitMarkdownSections can build a heading path, list
 * items become bullets, block ends become paragraph breaks, and every other
 * tag goes away.
 *
 * mammoth does have a markdown writer, but it is deprecated and absent from
 * its typings, so depending on it would mean casting past the types to reach
 * an API its author is removing.
 */
export function docxHtmlToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, level: string, inner: string) => {
      const text = stripTags(inner).trim();
      return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "\n\n";
    })
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (_m, inner: string) => {
      const text = stripTags(inner).trim();
      return text ? `\n- ${text}` : "";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|table|ul|ol|blockquote)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .split("\n")
    .map((line) => stripTags(line).replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
}

async function extractDocxMarkdown(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: bytes }));
  } catch {
    throw new DocumentParseError("That Word document could not be read. It may be damaged.");
  }
  return docxHtmlToMarkdown(html);
}
