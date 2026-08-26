import type { CoherenceFinding, CoherenceSkip } from "../../../../../shared/types/coherence.js";
import type { FileSymbols, SymbolTable, TypeSig } from "./symbols.js";

// ---------------------------------------------------------------------------
// Python symbol extraction + coherence checks (v1). Same conservative, fail-open
// philosophy as the C# and TypeScript checkers: an idiom the regex was not built
// for is SKIPPED, never guessed.
//
// The one structural difference from the brace-based extractors: Python scope is
// by INDENTATION, so class/method membership is tracked by indent column, not by
// `{`/`}` depth.
//
// v1 runs TWO checks and DELIBERATELY SKIPS two others (disclosed, per the T2
// PR-0 investigation):
//   • type_resolution (warning) — a referenced domain type (base class, type
//     annotation, or PascalCase instantiation) that is neither defined in the
//     change/repo, nor imported, nor a builtin/typing/generic name. Only the
//     ANNOTATED subset of Python is visible; unannotated dynamic code is simply
//     not seen (under-fire, never a false positive).
//   • caller_callee (error, NAME-ONLY) — a call whose receiver resolves via a
//     typed attribute to a known internal type that declares no such member.
//     Receiver resolution needs type annotations, so this is dormant on
//     untyped code (disclosed).
//
// SKIPPED in v1 (recorded as skips):
//   • interface_impl — Python has no `interface`. ABCs already fail LOUDLY at
//     instantiation (runtime-enforced), so the checker's marginal value is low;
//     Protocols are structural (unknowable syntactically) and ABC.register()
//     conformance has no syntactic link. Not approximated.
//   • imports — module-path resolution, unlike C# namespaces. Not approximated;
//     type_resolution already treats imported names as resolvable.
// Also intentionally NOT checked: bare function-call existence (builtins, and
// `from x import *` wildcards, make it high-false-positive).
// ---------------------------------------------------------------------------

// PascalCase lib / typing / builtin names treated as always-resolvable.
// (Lowercase builtins — int, str, list, dict, … — are dropped by the PascalCase
// gate before this set is consulted.)
const PY_ALLOW = new Set([
  // capitalized value-ish keywords used in annotations
  "None", "True", "False", "Any", "Self", "NoReturn", "Never", "Ellipsis",
  // typing constructs
  "List", "Dict", "Set", "FrozenSet", "Tuple", "Optional", "Union", "Callable",
  "Iterable", "Iterator", "Sequence", "Mapping", "MutableMapping", "MutableSequence",
  "Type", "TypeVar", "Generic", "Protocol", "Literal", "Final", "ClassVar",
  "Annotated", "Awaitable", "Coroutine", "AsyncIterator", "AsyncIterable",
  "AsyncGenerator", "Generator", "NamedTuple", "TypedDict", "Counter", "Deque",
  "DefaultDict", "OrderedDict", "ChainMap", "Text", "AnyStr", "IO", "TextIO", "BinaryIO",
  // common stdlib PascalCase classes / bases
  "Enum", "IntEnum", "StrEnum", "Flag", "IntFlag", "Path", "PurePath", "Decimal",
  "Fraction", "Exception", "BaseException", "ValueError", "TypeError", "KeyError",
  "IndexError", "RuntimeError", "NotImplementedError", "StopIteration", "OSError",
  "FileNotFoundError", "Thread", "Lock", "Event", "Queue", "Future", "Task",
  "ABC", "ABCMeta", "datetime", "date", "time", "timedelta", "UUID",
  // pydantic / fastapi common bases (usually imported, but low-value to flag)
  "BaseModel", "BaseSettings",
]);

const isGenericParam = (name: string): boolean => /^[A-Z][0-9]?$/.test(name);
const isPascal = (s: string): boolean => /^[A-Z][A-Za-z0-9_]*$/.test(s);
const stripSub = (t: string): string => t.replace(/[[\]].*$/, "").replace(/\|.*$/, "").trim();

function countArity(params: string): number {
  const s = params.trim();
  if (!s) return 0;
  let depth = 0;
  let commas = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) commas++;
  }
  return commas + 1;
}

const CLASS_DECL = /^([ \t]*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/;
const DEF_DECL = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/;
const SELF_ATTR = /^[ \t]*self\.([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.[\]]*)/;
const VAR_ANNOT = /^[ \t]*([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.[\]]*)/;
const SELF_ASSIGN = /^[ \t]*self\.([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*$/;
const RETURN_ANNOT = /->\s*([A-Za-z_][\w.[\]]*)/g;
const PARAM_ANNOT = /[(,]\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.[\]]*)/g;
const CALL = /(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\(/g;
const CALL_KEYWORDS = new Set([
  "if", "elif", "while", "for", "with", "return", "yield", "assert", "del", "raise",
  "await", "not", "and", "or", "in", "is", "lambda", "print", "super", "isinstance",
  "issubclass", "hasattr", "getattr", "setattr", "len", "range", "enumerate", "zip",
  "map", "filter", "sorted", "self", "cls",
]);

/** Parse Python import bindings. `wildcard` blocks type_resolution for the file. */
function extractImports(content: string): { names: string[]; wildcard: boolean } {
  const names: string[] = [];
  let wildcard = false;
  for (const m of content.matchAll(/^[ \t]*from\s+[\w.]+\s+import\s+(\*|\([\s\S]*?\)|[^\n#]+)/gm)) {
    let body = m[1].trim();
    if (body === "*") {
      wildcard = true;
      continue;
    }
    body = body.replace(/^\(|\)$/g, "");
    for (const raw of body.split(",")) {
      const entry = raw.replace(/#.*$/, "").trim();
      if (!entry || entry === "*") continue;
      const asM = entry.split(/\s+as\s+/);
      const bind = (asM[1] ?? asM[0]).trim();
      if (bind) names.push(bind);
    }
  }
  for (const m of content.matchAll(/^[ \t]*import\s+([^\n#]+)/gm)) {
    for (const raw of m[1].split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      const asM = entry.split(/\s+as\s+/);
      names.push(asM[1] ? asM[1].trim() : entry.split(".")[0].trim());
    }
  }
  return { names, wildcard };
}

interface Scope {
  kind: "class" | "def";
  indent: number;
  type?: TypeSig;
  ctorParams?: Map<string, string>; // __init__ param name → type, for self-attr linking
}

/** Extract Python symbols from one file. Conservative — unparseable constructs are skipped, not guessed. */
export function extractPythonSymbols(filePath: string, content: string): FileSymbols {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const { names, wildcard } = extractImports(content);
  // `usings` carries the imported binding names (repurposed from C#'s namespace
  // model); a wildcard import is recorded so the checker can skip type_resolution.
  const sym: FileSymbols = { filePath, namespace: wildcard ? "*" : null, usings: names, types: [], fields: [], calls: [], typeRefs: [], skipped: [] };
  const resolvable = new Set(names);

  const pushTypeRef = (raw: string, line: number): void => {
    const name = stripSub(raw);
    if (name.includes(".")) return; // module-qualified — assume resolvable
    if (!isPascal(name) || isGenericParam(name) || PY_ALLOW.has(name) || resolvable.has(name)) return;
    sym.typeRefs.push({ name, line });
  };

  const stack: Scope[] = [];
  // A def is a METHOD only when its direct parent (stack top after dedent) is a
  // class; nearestClass searches down the stack for field extraction inside a
  // method body (where the top is the def, not the class).
  const topClass = (): Scope | null => (stack.length && stack[stack.length - 1].kind === "class" ? stack[stack.length - 1] : null);
  const nearestClass = (): Scope | null => {
    for (let j = stack.length - 1; j >= 0; j--) if (stack[j].kind === "class") return stack[j];
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/#.*$/, "");
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) continue; // blank/comment — does not affect indentation scope
    const indent = raw.length - raw.trimStart().length;

    // Dedent: leave any scope whose body we have exited.
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();

    const cMatch = CLASS_DECL.exec(raw);
    const dMatch = cMatch ? null : DEF_DECL.exec(raw);

    if (cMatch) {
      const [, , name, baseList] = cMatch;
      const bases = baseList ? baseList.split(",").map((b) => stripSub(b)).filter(Boolean) : [];
      const type: TypeSig = { kind: "class", name, bases, methods: [], line: lineNo };
      sym.types.push(type);
      for (const b of bases) pushTypeRef(b, lineNo);
      stack.push({ kind: "class", indent, type });
      continue;
    }

    if (dMatch) {
      const [, , name, params] = dMatch;
      const cls = topClass(); // a method's direct parent is the class
      if (cls?.type) {
        cls.type.methods.push({ name, arity: countArity(params), line: lineNo, isPublic: !name.startsWith("_") });
        if (name === "__init__") {
          cls.ctorParams = new Map();
          for (const p of params.split(",")) {
            const pm = /^\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.[\]]*)/.exec(p.trim());
            if (pm) cls.ctorParams.set(pm[1], stripSub(pm[2]));
          }
        }
      }
      // Param annotations are type references (the value in `a: Type`).
      for (const pm of raw.matchAll(PARAM_ANNOT)) pushTypeRef(pm[2], lineNo);
      for (const rm of raw.matchAll(RETURN_ANNOT)) pushTypeRef(rm[1], lineNo);
      const opens = (raw.match(/\(/g)?.length ?? 0) - (raw.match(/\)/g)?.length ?? 0);
      if (opens > 0) sym.skipped.push({ filePath, line: lineNo, reason: "multi-line signature", detail: trimmed.slice(0, 80) });
      stack.push({ kind: "def", indent });
      continue;
    }

    const cls = nearestClass();

    // Typed attributes / fields (for receiver resolution).
    const selfAttr = SELF_ATTR.exec(raw);
    if (selfAttr && cls?.type) {
      sym.fields.push({ name: selfAttr[1], typeName: stripSub(selfAttr[2]) });
      pushTypeRef(selfAttr[2], lineNo);
    } else {
      // `self.x = param` links to the ctor param's type (the common DI pattern).
      const selfAssign = SELF_ASSIGN.exec(raw);
      if (selfAssign && cls?.ctorParams?.has(selfAssign[2])) {
        sym.fields.push({ name: selfAssign[1], typeName: cls.ctorParams.get(selfAssign[2])! });
      } else {
        const varAnnot = VAR_ANNOT.exec(raw);
        if (varAnnot) {
          sym.fields.push({ name: varAnnot[1], typeName: stripSub(varAnnot[2]) });
          pushTypeRef(varAnnot[2], lineNo);
        }
      }
    }

    // Calls + PascalCase instantiations in bodies.
    for (const c of raw.matchAll(CALL)) {
      if (CALL_KEYWORDS.has(c[2])) continue;
      if (!c[1] && isPascal(c[2])) {
        pushTypeRef(c[2], lineNo); // bare PascalCase call = instantiation
        continue;
      }
      sym.calls.push({ receiver: c[1] ?? null, method: c[2], arity: null, line: lineNo });
    }
    for (const rm of raw.matchAll(RETURN_ANNOT)) pushTypeRef(rm[1], lineNo);
  }

  return sym;
}

// ---------------------------------------------------------------------------
// The two Python checks (+ two disclosed skips).
// ---------------------------------------------------------------------------

export function checkPython(sug: FileSymbols[], combined: SymbolTable, _changedPaths: Set<string>): { findings: CoherenceFinding[]; skipped: CoherenceSkip[] } {
  const findings: CoherenceFinding[] = [];
  const skipped: CoherenceSkip[] = sug.flatMap((f) => f.skipped);

  for (const fs of sug) {
    skipped.push({ filePath: fs.filePath, reason: "interface_impl not checked for Python (ABCs are runtime-enforced; Protocols structural — v1 skip)" });
    skipped.push({ filePath: fs.filePath, reason: "imports not checked for Python (module-path resolution — v1 skip)" });
  }

  // 1 — type_resolution (warning). The extractor has already dropped imported,
  // builtin/typing, and generic-parameter names. A file with a wildcard import
  // (`from x import *`) cannot know what is in scope, so it is skipped whole.
  for (const fs of sug) {
    if (fs.namespace === "*") {
      skipped.push({ filePath: fs.filePath, reason: "wildcard import (from x import *) — type_resolution not evaluated" });
      continue;
    }
    for (const ref of fs.typeRefs) {
      if (!combined.typeExists(ref.name)) {
        findings.push({
          check: "type_resolution",
          severity: "warning",
          filePath: fs.filePath,
          line: ref.line,
          message: `Type ${ref.name} is referenced but not defined or imported in this change or the repository.`,
        });
      }
    }
  }

  // 2 — caller_callee (error, name-only). Only for calls whose receiver resolves
  // to a known internal type via a typed attribute — bare/untyped receivers are
  // skipped, not guessed. No arity comparison (Python defaults/*args/**kwargs
  // make arity unreliable).
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
        if (!combined.typeHasAnyMethod(recvType)) {
          skipped.push({ filePath: fs.filePath, line: call.line, reason: "receiver type members not parsed", detail: `${recvType}.${call.method}` });
        } else {
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
  }

  return { findings, skipped };
}
