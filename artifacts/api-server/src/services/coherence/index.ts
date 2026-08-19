import type { SuggestionFile } from "../../../../../shared/types/codeSuggestion.js";
import type { CoherenceFinding, CoherenceResult, CoherenceSkip, CoherenceStatus } from "../../../../../shared/types/coherence.js";
import { extractCSharpSymbols, type FileSymbols, type TypeSig } from "./csharp.js";

// ---------------------------------------------------------------------------
// Symbol table over a set of files (combined suggestion + repo, or repo alone).
// ---------------------------------------------------------------------------

export interface SymbolTable {
  files: FileSymbols[];
  typeExists(name: string): boolean;
  typeFiles(name: string): string[];
  implementorsOf(iface: string): Array<{ filePath: string; type: TypeSig }>;
  /** Arities of methods named `method` on any type named `typeName`. null = type unknown. */
  methodArities(typeName: string, method: string): number[] | null;
}

/** The pre-built symbol index for the UNCHANGED repo (read by the caller). */
export type RepoSymbolIndex = SymbolTable;

function buildSymbolTable(fileSymbols: FileSymbols[]): SymbolTable {
  const byType = new Map<string, Array<{ filePath: string; type: TypeSig }>>();
  for (const fs of fileSymbols) {
    for (const t of fs.types) {
      if (!byType.has(t.name)) byType.set(t.name, []);
      byType.get(t.name)!.push({ filePath: fs.filePath, type: t });
    }
  }
  return {
    files: fileSymbols,
    typeExists: (name) => byType.has(name),
    typeFiles: (name) => (byType.get(name) ?? []).map((e) => e.filePath),
    implementorsOf: (iface) => {
      const out: Array<{ filePath: string; type: TypeSig }> = [];
      for (const fs of fileSymbols) for (const t of fs.types) if (t.kind !== "interface" && t.bases.includes(iface)) out.push({ filePath: fs.filePath, type: t });
      return out;
    },
    methodArities: (typeName, method) => {
      const entries = byType.get(typeName);
      if (!entries) return null;
      const arities: number[] = [];
      for (const e of entries) for (const m of e.type.methods) if (m.name === method) arities.push(m.arity);
      return arities;
    },
  };
}

/** Build the repo symbol index from unchanged files (v1: C#). */
export function buildRepoSymbolIndex(files: Array<{ filePath: string; content: string }>): RepoSymbolIndex {
  return buildSymbolTable(files.filter((f) => f.filePath.endsWith(".cs")).map((f) => extractCSharpSymbols(f.filePath, f.content)));
}

// ---------------------------------------------------------------------------
// The four checks
// ---------------------------------------------------------------------------

/** Prefer a changed (suggestion) file for the finding's filePath; fall back to any. */
function pickChanged(changedPaths: Set<string>, ...paths: string[]): string {
  return paths.find((p) => changedPaths.has(p)) ?? paths[0];
}

function checkAll(sug: FileSymbols[], combined: SymbolTable, changedPaths: Set<string>): { findings: CoherenceFinding[]; skipped: CoherenceSkip[] } {
  const findings: CoherenceFinding[] = [];
  const skipped: CoherenceSkip[] = sug.flatMap((f) => f.skipped);

  // 1 — interface/implementation agreement.
  for (const fs of sug) {
    for (const iface of fs.types.filter((t) => t.kind === "interface")) {
      const impls = combined.implementorsOf(iface.name);
      if (impls.length === 0) {
        skipped.push({ filePath: fs.filePath, line: iface.line, reason: "no implementor indexed", detail: iface.name });
        continue;
      }
      for (const m of iface.methods) {
        for (const impl of impls) {
          const arities = combined.methodArities(impl.type.name, m.name);
          if (arities == null || arities.length === 0) {
            findings.push({
              check: "interface_impl",
              severity: "error",
              filePath: pickChanged(changedPaths, impl.filePath, fs.filePath),
              line: m.line,
              message: `${iface.name} declares ${m.name}(${m.arity} param${m.arity === 1 ? "" : "s"}), but ${impl.type.name} does not implement it.`,
              relatedFilePath: impl.filePath === fs.filePath ? undefined : impl.filePath,
            });
          } else if (!arities.includes(m.arity)) {
            findings.push({
              check: "interface_impl",
              severity: "warning",
              filePath: pickChanged(changedPaths, impl.filePath, fs.filePath),
              line: m.line,
              message: `${iface.name}.${m.name} takes ${m.arity} param(s), but ${impl.type.name}.${m.name} takes ${arities.join("/")}.`,
              relatedFilePath: impl.filePath === fs.filePath ? undefined : impl.filePath,
            });
          }
        }
      }
    }
    // Direction 2 (conservative warning): a public method on a class whose sole
    // base is a known interface, not declared on that interface. The most
    // false-positive-prone check — a class may legitimately expose helpers.
    for (const cls of fs.types.filter((t) => t.kind === "class")) {
      const ifaceBases = cls.bases.filter((b) => combined.files.some((f) => f.types.some((t) => t.name === b && t.kind === "interface")));
      if (ifaceBases.length !== 1) continue;
      const iface = ifaceBases[0];
      for (const m of cls.methods.filter((mm) => mm.isPublic)) {
        const onIface = combined.methodArities(iface, m.name);
        if (onIface && onIface.length === 0) {
          findings.push({
            check: "interface_impl",
            severity: "warning",
            filePath: fs.filePath,
            line: m.line,
            message: `${cls.name}.${m.name} is public but ${iface} does not declare it.`,
            relatedFilePath: combined.typeFiles(iface).find((p) => p !== fs.filePath),
          });
        }
      }
    }
  }

  // 2 — caller/callee agreement (only for calls whose receiver resolves to a
  // known internal type — framework/LINQ calls are skipped, not guessed).
  for (const fs of sug) {
    const fieldType = new Map(fs.fields.map((f) => [f.name, f.typeName]));
    for (const call of fs.calls) {
      const recvType = call.receiver ? fieldType.get(call.receiver) : undefined;
      if (!recvType) {
        skipped.push({ filePath: fs.filePath, line: call.line, reason: "unresolved call receiver", detail: `${call.receiver ?? "<none>"}.${call.method}` });
        continue;
      }
      const arities = combined.methodArities(recvType, call.method);
      if (arities == null) {
        skipped.push({ filePath: fs.filePath, line: call.line, reason: "receiver type not indexed", detail: `${recvType}.${call.method}` });
      } else if (arities.length === 0) {
        findings.push({
          check: "caller_callee",
          severity: "error",
          filePath: fs.filePath,
          line: call.line,
          message: `${fs.filePath.split("/").pop()} calls ${call.method}, but ${recvType} declares no such method.`,
          relatedFilePath: combined.typeFiles(recvType).find((p) => p !== fs.filePath),
        });
      }
    }
  }

  // 3 — type resolution (warning: a referenced type could live in an unread
  // namespace, so this never blocks — it flags).
  for (const fs of sug) {
    for (const ref of fs.typeRefs) {
      if (!combined.typeExists(ref.name)) {
        findings.push({
          check: "type_resolution",
          severity: "warning",
          filePath: fs.filePath,
          line: ref.line,
          message: `Type ${ref.name} is referenced but not defined in this change or the repository.`,
        });
      }
    }
  }

  // 4 — import/using completeness (warning): a type defined elsewhere in THIS
  // change, in a different namespace, referenced without a using.
  const nsOfType = new Map<string, string>();
  for (const fs of sug) for (const t of fs.types) if (fs.namespace) nsOfType.set(t.name, fs.namespace);
  for (const fs of sug) {
    // A file with no explicit usings is likely relying on global/implicit
    // usings (C# 10+), which the checker cannot see — skip rather than false-fire.
    if (fs.usings.length === 0) {
      if (fs.typeRefs.length > 0) skipped.push({ filePath: fs.filePath, reason: "no explicit usings (global usings not visible)" });
      continue;
    }
    for (const ref of fs.typeRefs) {
      const ns = nsOfType.get(ref.name);
      if (!ns || ns === fs.namespace) continue;
      if (!fs.usings.includes(ns)) {
        findings.push({
          check: "imports",
          severity: "warning",
          filePath: fs.filePath,
          line: ref.line,
          message: `Type ${ref.name} is in namespace ${ns} but ${fs.filePath.split("/").pop()} has no matching using.`,
        });
      }
    }
  }

  return { findings, skipped };
}

// ---------------------------------------------------------------------------
// Entry point
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
 * (Phase 3). v1 handles C# only; a single-file suggestion, an unsupported
 * language, or no analysable files returns a clean pass. `repoContext` supplies
 * symbols for files this suggestion does not touch (read by the caller from the
 * unchanged repo).
 */
export function checkCoherence(files: SuggestionFile[], repoContext: RepoSymbolIndex): CoherenceResult {
  const analysable = files.filter((f) => f.op !== "delete" && f.applyStatus === "applied");
  if (analysable.length <= 1) return PASS; // nothing to be incoherent with
  if (!analysable.every((f) => f.filePath.endsWith(".cs"))) {
    return { ...PASS, skipped: [{ filePath: analysable[0]?.filePath ?? "", reason: "unsupported language (v1 checks C# only)" }] };
  }

  const sug = analysable.map((f) => extractCSharpSymbols(f.filePath, f.content));
  const combined = buildSymbolTable([...sug, ...repoContext.files]);
  const changedPaths = new Set(sug.map((f) => f.filePath));

  const { findings, skipped } = checkAll(sug, combined, changedPaths);
  return { findings, skipped, ...scoreOf(findings) };
}
