import type { CoherenceSkip } from "../../../../../shared/types/coherence.js";

// ---------------------------------------------------------------------------
// Language-neutral symbol model shared by every language checker (C#, TS, …).
// Each language's extractor produces FileSymbols; the checks and the symbol
// table operate on this shape without knowing the source language. This module
// is the seam a new language registers into (Phase 3 → multi-language).
// ---------------------------------------------------------------------------

export interface MethodSig {
  name: string;
  arity: number;
  line: number;
  isPublic: boolean;
}
export interface TypeSig {
  kind: "class" | "interface" | "record" | "struct" | "enum";
  name: string;
  bases: string[]; // base class + implemented interfaces, generics stripped
  methods: MethodSig[];
  line: number;
}
export interface FieldSig {
  name: string; // e.g. "_policyService"
  typeName: string; // base identifier, generics stripped, e.g. "IPolicyService"
}
export interface CallSig {
  receiver: string | null; // field/var name the call is on, or null (bare/this/chained)
  method: string;
  arity: number | null; // null when the args were too complex to count reliably
  line: number;
}
export interface TypeRefSig {
  name: string;
  line: number;
}
export interface FileSymbols {
  filePath: string;
  namespace: string | null;
  usings: string[];
  types: TypeSig[];
  fields: FieldSig[];
  calls: CallSig[];
  typeRefs: TypeRefSig[];
  skipped: CoherenceSkip[];
}

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
  /** True when a type of this name is indexed AND had ≥1 method extracted. */
  typeHasAnyMethod(name: string): boolean;
}

/** The pre-built symbol index for the UNCHANGED repo (read by the caller). */
export type RepoSymbolIndex = SymbolTable;

export function buildSymbolTable(fileSymbols: FileSymbols[]): SymbolTable {
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
    typeHasAnyMethod: (name) => (byType.get(name) ?? []).some((e) => e.type.methods.length > 0),
  };
}

/** Prefer a changed (suggestion) file for a finding's filePath; fall back to any. */
export function pickChanged(changedPaths: Set<string>, ...paths: string[]): string {
  return paths.find((p) => changedPaths.has(p)) ?? paths[0];
}
