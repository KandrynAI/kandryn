import type { SuggestionFile } from "../../../../../shared/types/codeSuggestion.js";
import type { CoherenceFinding, CoherenceResult, CoherenceStatus } from "../../../../../shared/types/coherence.js";
import type { FileSymbols, SymbolTable, RepoSymbolIndex } from "./symbols.js";
import { buildSymbolTable } from "./symbols.js";
import { extractCSharpSymbols, checkCSharp } from "./csharp.js";
import { extractTypeScriptSymbols, checkTypeScript } from "./typescript.js";
import { extractPythonSymbols, checkPython } from "./python.js";

export type { RepoSymbolIndex } from "./symbols.js";

// ---------------------------------------------------------------------------
// Language registry — the single dispatch seam every language plugs into. A new
// language is one entry here (its extensions, extractor, and checks); nothing
// upstream changes. `extractorFor` buckets a file by extension.
// ---------------------------------------------------------------------------

interface LanguageModule {
  extensions: string[];
  extract(filePath: string, content: string): FileSymbols;
  check(sug: FileSymbols[], combined: SymbolTable, changedPaths: Set<string>): { findings: CoherenceFinding[]; skipped: CoherenceResult["skipped"] };
}

const MODULES: LanguageModule[] = [
  { extensions: [".cs"], extract: extractCSharpSymbols, check: checkCSharp },
  { extensions: [".ts", ".tsx"], extract: extractTypeScriptSymbols, check: checkTypeScript },
  { extensions: [".py"], extract: extractPythonSymbols, check: checkPython },
];

/** The language module owning a file, by extension — or null if unsupported. */
export function extractorFor(filePath: string): LanguageModule | null {
  const lower = filePath.toLowerCase();
  return MODULES.find((m) => m.extensions.some((e) => lower.endsWith(e))) ?? null;
}

/** True when a file's extension is handled by some coherence language module. */
export function coherenceSupported(filePath: string): boolean {
  return extractorFor(filePath) != null;
}

/** True when two files are handled by the same (non-null) language module. */
export function sameCoherenceLanguage(a: string, b: string): boolean {
  const ma = extractorFor(a);
  return ma != null && ma === extractorFor(b);
}

/** The single module all paths belong to, or null if any is unsupported or they mix languages. */
function singleLanguageModule(paths: string[]): LanguageModule | null {
  if (paths.length === 0) return null;
  const mods = paths.map(extractorFor);
  const first = mods[0];
  if (!first) return null;
  return mods.every((m) => m === first) ? first : null;
}

/**
 * Build the repo symbol index from unchanged files. Each file is extracted by
 * its own language module; unsupported files are dropped. A mixed-language repo
 * context is fine — the checks query by type name, and a suggestion in one
 * language will only match symbols in that language.
 */
export function buildRepoSymbolIndex(files: Array<{ filePath: string; content: string }>): RepoSymbolIndex {
  const syms: FileSymbols[] = [];
  for (const f of files) {
    const mod = extractorFor(f.filePath);
    if (mod) syms.push(mod.extract(f.filePath, f.content));
  }
  return buildSymbolTable(syms);
}

// ---------------------------------------------------------------------------
// Scoring + entry point
// ---------------------------------------------------------------------------

function scoreOf(findings: CoherenceFinding[]): { score: number; status: CoherenceStatus } {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const score = Math.max(0, 1 - errors * 0.25 - warnings * 0.1);
  const status: CoherenceStatus = errors > 0 ? "failed" : warnings > 0 ? "warnings" : "passed";
  return { score, status };
}

const PASS: CoherenceResult = { findings: [], skipped: [], score: 1, status: "passed" };

/**
 * Static, pre-commit coherence check across a suggestion's applied files
 * (Phase 3). Dispatches by language via the registry; C# and TypeScript are
 * supported. A single-file suggestion, an unsupported language, or a suggestion
 * mixing languages returns a clean pass (with a skip note for the latter two).
 * `repoContext` supplies symbols for files this suggestion does not touch (read
 * by the caller from the unchanged repo).
 */
export function checkCoherence(files: SuggestionFile[], repoContext: RepoSymbolIndex): CoherenceResult {
  const analysable = files.filter((f) => f.op !== "delete" && f.applyStatus === "applied");
  if (analysable.length <= 1) return PASS; // nothing to be incoherent with

  const mod = singleLanguageModule(analysable.map((f) => f.filePath));
  if (!mod) {
    return { ...PASS, skipped: [{ filePath: analysable[0]?.filePath ?? "", reason: "unsupported or mixed languages (checker runs per single language)" }] };
  }

  const sug = analysable.map((f) => mod.extract(f.filePath, f.content));
  const combined = buildSymbolTable([...sug, ...repoContext.files]);
  const changedPaths = new Set(sug.map((f) => f.filePath));

  const { findings, skipped } = mod.check(sug, combined, changedPaths);
  return { findings, skipped, ...scoreOf(findings) };
}
