import type { CoherenceFinding, CoherenceSkip } from "../../../../../shared/types/coherence.js";
import type { FileSymbols, SymbolTable, TypeSig } from "./symbols.js";

// ---------------------------------------------------------------------------
// TypeScript symbol extraction + coherence checks (v1). Same conservative,
// fail-open philosophy as the C# checker (PRs #97–99): an idiom the regex was
// not built for is SKIPPED, never guessed — a false positive on a correct
// multi-file change erodes trust in the score far more than an occasional miss.
//
// v1 runs TWO checks and DELIBERATELY SKIPS two others (disclosed, not weakly
// approximated), per the T1 PR-0 investigation:
//   • type_resolution (warning) — a referenced domain type that is neither
//     defined in the change/repo, nor imported, nor a lib/utility/generic type.
//     TypeScript is structurally typed and types are overwhelmingly imported
//     (94 interfaces / 0 `implements` in the reference frontend), so import- and
//     lib-awareness is what keeps this low-false-positive.
//   • caller_callee (error, NAME-ONLY — no arity) — a call whose receiver
//     resolves to a known internal type that declares no such member.
//
// SKIPPED in v1 (recorded as skips, see checkTypeScript):
//   • interface_impl — TS is structurally typed; a class rarely writes
//     `implements`, so an explicit-only check is inert and a structural one is
//     high-false-positive. Not approximated.
//   • imports — TS import correctness is module-path-based, unlike C#'s
//     namespace/using model; a meaningful check needs real resolution. Not
//     approximated; type_resolution already treats imported names as resolvable.
// Also intentionally NOT checked: bare function-call existence (hooks, globals,
// chained calls make it high-false-positive without a large allowlist).
// ---------------------------------------------------------------------------

// Lib / built-in / framework type names treated as always-resolvable. PascalCase
// only (lowercase primitives are filtered by the PascalCase gate before this).
const TS_LIB = new Set([
  // capitalized primitives / boxed
  "String", "Number", "Boolean", "Object", "Symbol", "BigInt", "Function",
  // TS utility types
  "Partial", "Required", "Readonly", "Record", "Pick", "Omit", "Exclude", "Extract",
  "NonNullable", "Parameters", "ConstructorParameters", "ReturnType", "InstanceType",
  "ThisParameterType", "OmitThisParameter", "ThisType", "Uppercase", "Lowercase",
  "Capitalize", "Uncapitalize", "Awaited", "NoInfer",
  // core lib
  "Array", "ReadonlyArray", "Promise", "Map", "ReadonlyMap", "Set", "ReadonlySet",
  "WeakMap", "WeakSet", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "JSON", "Math", "Iterator", "Iterable", "IterableIterator", "AsyncIterable",
  "Generator", "AsyncGenerator", "ArrayBuffer", "Uint8Array", "Int32Array",
  "Float64Array", "DataView", "Proxy", "Reflect", "Intl", "Tuple",
  // DOM / browser
  "Element", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLDivElement",
  "HTMLFormElement", "HTMLAnchorElement", "Node", "Event", "MouseEvent", "KeyboardEvent",
  "FocusEvent", "ChangeEvent", "FormEvent", "PointerEvent", "DragEvent", "Document",
  "Window", "Blob", "File", "FileList", "FormData", "URL", "URLSearchParams", "Headers",
  "Request", "Response", "AbortController", "AbortSignal", "Storage", "Location",
  // React
  "React", "ReactNode", "ReactElement", "ReactChild", "ReactChildren", "ReactPortal",
  "FC", "FunctionComponent", "Component", "PureComponent", "PropsWithChildren",
  "CSSProperties", "JSX", "Ref", "RefObject", "MutableRefObject", "Dispatch",
  "SetStateAction", "Key", "Fragment", "Context", "Provider", "Consumer",
  // Node
  "Buffer", "NodeJS",
]);

// A generic type parameter: a single uppercase letter, optionally with a digit
// (T, K, V, U, R, S, E, P, T1, T2). Conventionally not a domain type.
const isGenericParam = (name: string): boolean => /^[A-Z][0-9]?$/.test(name);
const isPascal = (s: string): boolean => /^[A-Z][A-Za-z0-9_]*$/.test(s);
const baseId = (t: string): string => t.replace(/[<[].*$/, "").replace(/[|&].*$/, "").replace(/\?+$/, "").trim();

function countArity(params: string): number {
  const s = params.trim();
  if (!s) return 0;
  let depth = 0;
  let commas = 0;
  for (const ch of s) {
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) commas++;
  }
  return commas + 1;
}

const TYPE_DECL = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface)\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*(?:extends\s+([^{]+?))?\s*(?:implements\s+([^{]+?))?\s*(?:\{|$)/;
const TYPE_ALIAS = /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=\s*(\{)?/;
// A member method / arrow-typed member inside a type body.
const MEMBER_METHOD = /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|async\s+|get\s+|set\s+|\s)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/;
const MEMBER_ARROW = /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|\s)*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/;
// A typed class field: `name: Type` (not a method — no `(` before the colon end).
const FIELD_DECL = /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|\s)*([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*([A-Za-z_$][\w$.]*)/;
const CALL = /(?:(\b[A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
const ANNOTATION = /:\s*([A-Z][\w$]*)(?!\s*\.)/g; // `: Type` head, not namespace-qualified
const NEW_REF = /\bnew\s+([A-Z][\w$]*)/g;
const CALL_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "await", "async", "typeof", "keyof", "new", "function", "yield", "void", "throw", "super", "import", "constructor"]);

/** Parse the local binding names introduced by all `import ... from '...'` statements. */
function extractImports(content: string): string[] {
  const names: string[] = [];
  const IMPORT_RE = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s*['"][^'"]+['"]/g;
  for (const m of content.matchAll(IMPORT_RE)) {
    if (m[1]) names.push(m[1]); // default binding
    if (m[2]) names.push(m[2]); // namespace binding
    if (m[3]) {
      for (const raw of m[3].split(",")) {
        const entry = raw.trim().replace(/^type\s+/, "");
        if (!entry) continue;
        const asMatch = entry.split(/\s+as\s+/);
        const bind = (asMatch[1] ?? asMatch[0]).trim();
        if (bind) names.push(bind);
      }
    }
  }
  return names;
}

/** Extract TypeScript symbols from one file. Conservative — unparseable constructs are skipped, not guessed. */
export function extractTypeScriptSymbols(filePath: string, content: string): FileSymbols {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  // `usings` carries the imported binding names for TS (repurposed from C#'s
  // namespace model) — used by type_resolution to treat imported types as
  // resolvable. `namespace` stays null (TS has no using/namespace check).
  const imports = extractImports(content);
  const sym: FileSymbols = { filePath, namespace: null, usings: imports, types: [], fields: [], calls: [], typeRefs: [], skipped: [] };
  const resolvable = new Set(imports);

  const pushTypeRef = (name: string, line: number): void => {
    if (!isPascal(name) || isGenericParam(name) || TS_LIB.has(name) || resolvable.has(name)) return;
    sym.typeRefs.push({ name, line });
  };

  let depth = 0;
  const typeStack: Array<{ type: TypeSig; openDepth: number; entered: boolean }> = [];
  const currentType = () => (typeStack.length ? typeStack[typeStack.length - 1].type : null);
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\/\/.*$/, "");
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (/\/\*/.test(line) && !/\*\//.test(line)) inBlockComment = true;
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("import ") || trimmed.startsWith("export {")) {
      // still count braces so depth stays correct
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      continue;
    }

    let isDeclLine = false;

    const tMatch = TYPE_DECL.exec(line);
    const aMatch = tMatch ? null : TYPE_ALIAS.exec(line);
    if (tMatch) {
      const [, kind, name, ext, impl] = tMatch;
      const bases = [ext, impl].filter(Boolean).flatMap((b) => b!.split(",").map((x) => baseId(x)).filter(Boolean));
      const type: TypeSig = { kind: kind === "interface" ? "interface" : "class", name, bases, methods: [], line: lineNo };
      sym.types.push(type);
      for (const b of bases) pushTypeRef(b, lineNo); // extends/implements references
      typeStack.push({ type, openDepth: depth, entered: false });
      isDeclLine = true;
    } else if (aMatch) {
      const [, name, hasBrace] = aMatch;
      const type: TypeSig = { kind: "interface", name, bases: [], methods: [], line: lineNo };
      sym.types.push(type);
      // Only an object-literal alias (`type X = { ... }`) has a member body.
      if (hasBrace) typeStack.push({ type, openDepth: depth, entered: false });
      isDeclLine = true;
    }

    const ct = isDeclLine ? null : currentType();
    if (ct) {
      const opensParen = /\b[A-Za-z_$][\w$]*\s*\([^)]*$/.test(trimmed);
      if (opensParen && !/\)/.test(trimmed)) {
        sym.skipped.push({ filePath, line: lineNo, reason: "multi-line signature", detail: trimmed.slice(0, 80) });
      } else {
        const arrow = MEMBER_ARROW.exec(line);
        const method = arrow ? null : MEMBER_METHOD.exec(line);
        if (arrow) {
          ct.methods.push({ name: arrow[1], arity: countArity(arrow[2]), line: lineNo, isPublic: !/\bprivate\b/.test(trimmed) });
          isDeclLine = true;
        } else if (method && !CALL_KEYWORDS.has(method[1]) && method[1] !== "constructor") {
          ct.methods.push({ name: method[1], arity: countArity(method[2]), line: lineNo, isPublic: !/\bprivate\b/.test(trimmed) });
          isDeclLine = true;
        } else {
          const field = FIELD_DECL.exec(line);
          if (field) {
            sym.fields.push({ name: field[1], typeName: baseId(field[2]) });
            pushTypeRef(baseId(field[2]), lineNo);
          }
        }
      }
      // Constructor parameter properties: `constructor(private svc: Svc, ...)`.
      const ctor = /\bconstructor\s*\(([^)]*)\)/.exec(line);
      if (ctor) {
        for (const p of ctor[1].split(",")) {
          const pm = /^\s*(?:public|private|protected|readonly)\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$.]*)/.exec(p);
          if (pm) {
            sym.fields.push({ name: pm[1], typeName: baseId(pm[2]) });
            pushTypeRef(baseId(pm[2]), lineNo);
          }
        }
      }
    }

    // References + calls in non-declaration lines.
    if (!isDeclLine) {
      for (const c of line.matchAll(CALL)) {
        if (CALL_KEYWORDS.has(c[2])) continue;
        sym.calls.push({ receiver: c[1] ?? null, method: c[2], arity: null, line: lineNo });
      }
      for (const n of line.matchAll(NEW_REF)) pushTypeRef(n[1], lineNo);
      // Annotation-head refs (`: Type`) — but a `<`/`>` before the first colon
      // means JSX text (`<p>Status: Active</p>`) or a generic return type; both
      // are false-positive traps, so skip the line's annotations (under-fire).
      const firstColon = line.indexOf(":");
      if (firstColon !== -1 && !/[<>]/.test(line.slice(0, firstColon))) {
        for (const a of line.matchAll(ANNOTATION)) pushTypeRef(a[1], lineNo);
      }
    }

    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    const top = typeStack[typeStack.length - 1];
    if (top && depth > top.openDepth) top.entered = true;
    while (typeStack.length && typeStack[typeStack.length - 1].entered && depth <= typeStack[typeStack.length - 1].openDepth) typeStack.pop();
  }

  return sym;
}

// ---------------------------------------------------------------------------
// The two TypeScript checks (+ two disclosed skips).
// ---------------------------------------------------------------------------

export function checkTypeScript(sug: FileSymbols[], combined: SymbolTable, _changedPaths: Set<string>): { findings: CoherenceFinding[]; skipped: CoherenceSkip[] } {
  const findings: CoherenceFinding[] = [];
  const skipped: CoherenceSkip[] = sug.flatMap((f) => f.skipped);

  // Disclose the two checks v1 does not run, per file, so the blind spot is
  // captured (like the C# checker's own skips) rather than silently implied.
  for (const fs of sug) {
    skipped.push({ filePath: fs.filePath, reason: "interface_impl not checked for TypeScript (structural typing — v1 skip)" });
    skipped.push({ filePath: fs.filePath, reason: "imports not checked for TypeScript (module-path resolution — v1 skip)" });
  }

  // 1 — type_resolution (warning). The extractor has already dropped imported,
  // lib/utility, and generic-parameter names, so a surviving ref is a domain
  // type that is defined nowhere the checker can see.
  for (const fs of sug) {
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
  // to a known internal type via a typed field — bare/imported-object receivers
  // are skipped, not guessed. No arity comparison (TS overloads/optionals make
  // arity unreliable), so a member of the right NAME is treated as present.
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
        // Receiver type indexed but no member of this name. Only an error when
        // the type had ≥1 member extracted — a type indexed with zero members
        // means extraction was incomplete, so we cannot assert absence.
        if (!combined.typeHasAnyMethod(recvType)) {
          skipped.push({ filePath: fs.filePath, line: call.line, reason: "receiver type members not parsed", detail: `${recvType}.${call.method}` });
        } else {
          findings.push({
            check: "caller_callee",
            severity: "error",
            filePath: fs.filePath,
            line: call.line,
            message: `${fs.filePath.split("/").pop()} calls ${call.method}, but ${recvType} declares no such member.`,
            relatedFilePath: combined.typeFiles(recvType).find((p) => p !== fs.filePath),
          });
        }
      }
    }
  }

  return { findings, skipped };
}
