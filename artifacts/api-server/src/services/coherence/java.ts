import type { CoherenceFinding, CoherenceSkip } from "../../../../../shared/types/coherence.js";
import type { FileSymbols, SymbolTable, TypeSig } from "./symbols.js";
import { pickChanged } from "./symbols.js";

// ---------------------------------------------------------------------------
// Java symbol extraction + coherence checks (v1). Java is the closest structural
// match to C# — explicit `implements`, explicit method signatures, explicit
// `import`s — so it ships the FULL four-check set, unlike the reduced TypeScript
// and Python checkers. Same conservative, fail-open philosophy: an idiom the
// regex was not built for is SKIPPED, never guessed.
//
// Java-specific rules (per the T3 PR-0 investigation):
//   • interface_impl requires only ABSTRACT interface methods — `default`/
//     `static`/`private` interface methods have bodies and are NOT part of the
//     implement contract (Java 8+). The one genuine logic change from C#.
//   • A class carrying a method-generating Lombok annotation (@Data, @Getter, …)
//     is marked OPAQUE: its member surface is incomplete, so both interface_impl
//     and caller_callee fail open against it (a generated getName() is invisible
//     to source-text extraction).
//   • Spring annotations (@Service, @Autowired, …) are skipped like any
//     annotation; DI'd dependencies are still typed field declarations, so
//     receiver resolution is unchanged.
//   • Checked exceptions (`throws IOException`) don't affect name+arity identity.
//   • Only implementor classes with NO superclass (bases are all known
//     interfaces) are checked for "does not implement" — a superclass may supply
//     the method (inheritance blind spot → fail open).
// ---------------------------------------------------------------------------

// java.lang (auto-imported) + very common JDK types treated as always-resolvable.
const JAVA_LANG = new Set([
  "void", "boolean", "byte", "char", "short", "int", "long", "float", "double",
  "Object", "String", "CharSequence", "Integer", "Long", "Short", "Byte", "Character",
  "Boolean", "Float", "Double", "Number", "Math", "System", "Thread", "Runnable",
  "Comparable", "Iterable", "Class", "Enum", "Record", "Void", "StringBuilder", "StringBuffer",
  "Exception", "RuntimeException", "Throwable", "Error", "IllegalArgumentException",
  "IllegalStateException", "NullPointerException", "UnsupportedOperationException",
  "IndexOutOfBoundsException", "ClassCastException", "InterruptedException",
  // java.util
  "List", "ArrayList", "LinkedList", "Map", "HashMap", "LinkedHashMap", "TreeMap",
  "Set", "HashSet", "LinkedHashSet", "TreeSet", "Collection", "Collections", "Arrays",
  "Optional", "Queue", "Deque", "ArrayDeque", "Iterator", "Comparator", "Objects",
  "UUID", "Date", "Calendar", "Random", "Scanner", "StringJoiner",
  // java.util.stream / function
  "Stream", "IntStream", "Collectors", "Function", "BiFunction", "Consumer", "BiConsumer",
  "Supplier", "Predicate", "BiPredicate", "UnaryOperator", "BinaryOperator",
  // java.util.concurrent
  "CompletableFuture", "Future", "ExecutorService", "Executors", "ConcurrentHashMap",
  "AtomicInteger", "AtomicLong", "AtomicBoolean", "CountDownLatch", "TimeUnit",
  // java.time
  "LocalDate", "LocalDateTime", "LocalTime", "Instant", "Duration", "Period", "ZonedDateTime",
  "ZoneId", "OffsetDateTime", "DayOfWeek", "Month",
  // java.io / nio
  "IOException", "InputStream", "OutputStream", "Reader", "Writer", "File", "Path", "Paths", "Files",
  // java.math
  "BigDecimal", "BigInteger",
]);

// Lombok annotations that GENERATE methods (getters/setters/builders/ctors),
// making a class's source-text method surface incomplete.
const LOMBOK_METHOD_GEN = new Set([
  "Data", "Value", "Getter", "Setter", "Builder", "SuperBuilder", "With",
  "RequiredArgsConstructor", "AllArgsConstructor", "NoArgsConstructor", "Accessors", "UtilityClass",
]);

const isGenericParam = (name: string): boolean => /^[A-Z][0-9]?$/.test(name);
const isPascal = (s: string): boolean => /^[A-Z][A-Za-z0-9_$]*$/.test(s);
const baseId = (t: string): string => t.replace(/<.*$/, "").replace(/\[.*$/, "").trim();

function countArity(params: string): number | null {
  const s = params.trim();
  if (!s) return 0;
  let depth = 0;
  let commas = 0;
  for (const ch of s) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) commas++;
  }
  return commas + 1;
}

const PACKAGE = /^\s*package\s+([\w.]+)\s*;/;
const IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/;
const TYPE_DECL = /^\s*(?:(?:public|private|protected|abstract|final|static|sealed|strictfp)\s+)*\b(class|interface|enum|record)\s+([A-Za-z_$]\w*)\b([^{]*)/;

/** Parse the extends/implements base list from a type declaration's tail. */
function parseBases(tail: string): string[] {
  const t = tail.replace(/<[^<>]*>/g, " "); // drop generic params/bounds so `<T extends X>` isn't read as a base
  const bases: string[] = [];
  const ext = /\bextends\s+(.+?)(?=\bimplements\b|\bpermits\b|$)/.exec(t);
  const impl = /\bimplements\s+(.+?)(?=\bpermits\b|$)/.exec(t);
  for (const clause of [ext?.[1], impl?.[1]]) {
    if (!clause) continue;
    for (const b of clause.split(",")) {
      const id = baseId(b);
      if (id) bases.push(id);
    }
  }
  return bases;
}
// A method declaration: [mods] [<generics>] returnType name(params) [throws …] (`{` or `;`).
const METHOD_DECL = /^\s*((?:public|private|protected|static|final|abstract|default|synchronized|native)\s+)*(?:<[^>]+>\s*)?([\w.$]+(?:<[^;{()]*>)?(?:\[\])*)\s+([A-Za-z_$]\w*)\s*\(([^)]*)\)/;
const FIELD_DECL = /^\s*((?:public|private|protected|static|final|volatile|transient)\s+)*([A-Za-z_$][\w.$]*(?:<[^;=]*>)?(?:\[\])*)\s+([A-Za-z_$]\w*)\s*(?:=|;)/;
const CALL = /(?:(\b[A-Za-z_$]\w*)\s*\.\s*)?([A-Za-z_$]\w*)\s*\(/g;
const METHOD_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "new", "throw", "super", "this", "assert", "synchronized", "instanceof"]);
const STMT_RETURN_TYPES = new Set(["return", "throw", "else", "case", "yield", "break", "continue"]);

export function extractJavaSymbols(filePath: string, content: string): FileSymbols {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const sym: FileSymbols = { filePath, namespace: null, usings: [], types: [], fields: [], calls: [], typeRefs: [], skipped: [] };

  // `usings` holds explicit-import simple names AND wildcard packages ("pkg.*").
  const importedNames = new Set<string>();

  let depth = 0;
  const typeStack: Array<{ type: TypeSig; openDepth: number; entered: boolean }> = [];
  const currentType = () => (typeStack.length ? typeStack[typeStack.length - 1].type : null);
  let inBlockComment = false;
  let pendingLombok = false; // a method-generating Lombok annotation seen before the next type

  const pushTypeRef = (raw: string, line: number): void => {
    const name = baseId(raw);
    if (!isPascal(name) || isGenericParam(name) || JAVA_LANG.has(name) || importedNames.has(name)) return;
    sym.typeRefs.push({ name, line });
  };

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\/\/.*$/, "");
    if (inBlockComment) {
      if (stripped.includes("*/")) inBlockComment = false;
      continue;
    }
    if (/\/\*/.test(stripped) && !/\*\//.test(stripped)) inBlockComment = true;
    const line = stripped;
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!sym.namespace) {
      const pMatch = PACKAGE.exec(line);
      if (pMatch) sym.namespace = pMatch[1];
    }
    const iMatch = IMPORT.exec(line);
    if (iMatch) {
      const path = iMatch[1];
      if (path.endsWith(".*")) {
        sym.usings.push(path);
      } else {
        const simple = path.slice(path.lastIndexOf(".") + 1);
        importedNames.add(simple);
        sym.usings.push(simple);
      }
      continue;
    }

    // Annotation lines: note method-generating Lombok, then skip. (Annotation
    // args may span the line; we only need the leading @Name.)
    const annot = /^\s*@([A-Za-z_$]\w*)/.exec(trimmed);
    if (annot) {
      if (LOMBOK_METHOD_GEN.has(annot[1])) pendingLombok = true;
      // still update brace depth in case of inline `@Foo({...})`
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      continue;
    }

    const tMatch = TYPE_DECL.exec(line);
    if (tMatch) {
      const [, kind, name, tail] = tMatch;
      const bases = parseBases(tail ?? "");
      const type: TypeSig = { kind: kind === "record" ? "record" : (kind as TypeSig["kind"]), name, bases, methods: [], line: lineNo };
      if (pendingLombok) type.opaque = true;
      pendingLombok = false;
      for (const b of bases) pushTypeRef(b, lineNo);
      sym.types.push(type);
      typeStack.push({ type, openDepth: depth, entered: false });
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      const top = typeStack[typeStack.length - 1];
      if (depth > top.openDepth) top.entered = true;
      continue;
    }
    pendingLombok = false; // a non-type, non-annotation line clears a stray note

    const ct = currentType();
    let isDeclLine = false;
    if (ct) {
      const opensParen = /\b[A-Za-z_$]\w*\s*\([^)]*$/.test(trimmed);
      if (opensParen && !/\)/.test(trimmed)) {
        sym.skipped.push({ filePath, line: lineNo, reason: "multi-line signature", detail: trimmed.slice(0, 80) });
      } else {
        const mMatch = METHOD_DECL.exec(line);
        if (mMatch) {
          const [, mods, returnType, name, params] = mMatch;
          const modStr = mods ?? "";
          if (!METHOD_KEYWORDS.has(name) && name !== ct.name && !STMT_RETURN_TYPES.has(baseId(returnType))) {
            isDeclLine = true;
            const arity = countArity(params);
            if (arity == null) {
              sym.skipped.push({ filePath, line: lineNo, reason: "unparseable parameter list", detail: trimmed.slice(0, 80) });
            } else {
              // In an interface, a method is abstract (part of the contract) only
              // when it ends in `;` and is not default/static/private.
              let isAbstract: boolean | undefined;
              if (ct.kind === "interface") {
                const concrete = /\b(default|static|private)\b/.test(modStr) || /\{\s*$/.test(trimmed) || !/;\s*$/.test(trimmed);
                isAbstract = !concrete;
              }
              ct.methods.push({ name, arity, line: lineNo, isPublic: /\bpublic\b/.test(modStr) || ct.kind === "interface", isAbstract });
            }
          }
        } else {
          const fMatch = FIELD_DECL.exec(line);
          if (fMatch && !fMatch[2].includes("(") && !STMT_RETURN_TYPES.has(baseId(fMatch[2]))) {
            sym.fields.push({ name: fMatch[3], typeName: baseId(fMatch[2]) });
            pushTypeRef(fMatch[2], lineNo);
          }
        }
      }
    }

    // Scan calls/instantiations: the whole line normally, or just the inline
    // body (after the first `{`) on a method-declaration line, so a delegating
    // one-liner `X foo() { bar.baz(); }` is not missed.
    let scanFrom: string;
    if (isDeclLine) {
      const b = line.indexOf("{");
      scanFrom = b >= 0 ? line.slice(b + 1) : "";
    } else {
      scanFrom = line;
    }
    for (const c of scanFrom.matchAll(CALL)) {
      if (METHOD_KEYWORDS.has(c[2])) continue;
      sym.calls.push({ receiver: c[1] ?? null, method: c[2], arity: null, line: lineNo });
    }
    for (const n of scanFrom.matchAll(/\bnew\s+([A-Z][\w$]*)/g)) pushTypeRef(n[1], lineNo);

    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    const top = typeStack[typeStack.length - 1];
    if (top && depth > top.openDepth) top.entered = true;
    while (typeStack.length && typeStack[typeStack.length - 1].entered && depth <= typeStack[typeStack.length - 1].openDepth) typeStack.pop();
  }

  return sym;
}

// ---------------------------------------------------------------------------
// The four Java checks.
// ---------------------------------------------------------------------------

export function checkJava(sug: FileSymbols[], combined: SymbolTable, changedPaths: Set<string>): { findings: CoherenceFinding[]; skipped: CoherenceSkip[] } {
  const findings: CoherenceFinding[] = [];
  const skipped: CoherenceSkip[] = sug.flatMap((f) => f.skipped);

  const opaqueTypes = new Set<string>();
  for (const fs of combined.files) for (const t of fs.types) if (t.opaque) opaqueTypes.add(t.name);
  const isKnownInterface = (name: string) => combined.files.some((f) => f.types.some((t) => t.name === name && t.kind === "interface"));

  // 1 — interface/implementation agreement (abstract interface methods only).
  for (const fs of sug) {
    for (const iface of fs.types.filter((t) => t.kind === "interface")) {
      const impls = combined.implementorsOf(iface.name);
      if (impls.length === 0) {
        skipped.push({ filePath: fs.filePath, line: iface.line, reason: "no implementor indexed", detail: iface.name });
        continue;
      }
      const required = iface.methods.filter((m) => m.isAbstract !== false); // exclude default/static/private
      for (const m of required) {
        for (const impl of impls) {
          if (impl.type.opaque || opaqueTypes.has(impl.type.name)) {
            skipped.push({ filePath: impl.filePath, line: iface.line, reason: "implementor is Lombok-opaque (generated methods)", detail: impl.type.name });
            continue;
          }
          // A superclass (a base that is not a known interface) may supply the
          // method — inheritance blind spot, fail open.
          if (impl.type.bases.some((b) => !isKnownInterface(b))) {
            skipped.push({ filePath: impl.filePath, line: iface.line, reason: "implementor has a superclass (method may be inherited)", detail: impl.type.name });
            continue;
          }
          const arities = combined.methodArities(impl.type.name, m.name);
          if (arities == null || arities.length === 0) {
            if (impl.type.methods.length === 0) {
              skipped.push({ filePath: impl.filePath, line: iface.line, reason: "implementor methods not parsed", detail: impl.type.name });
              continue;
            }
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
  }

  // 2 — caller/callee agreement (receiver resolved via a typed field).
  for (const fs of sug) {
    const fieldType = new Map(fs.fields.map((f) => [f.name, f.typeName]));
    for (const call of fs.calls) {
      const recvType = call.receiver ? fieldType.get(call.receiver) : undefined;
      if (!recvType) {
        skipped.push({ filePath: fs.filePath, line: call.line, reason: "unresolved call receiver", detail: `${call.receiver ?? "<none>"}.${call.method}` });
        continue;
      }
      if (opaqueTypes.has(recvType)) {
        skipped.push({ filePath: fs.filePath, line: call.line, reason: "receiver is Lombok-opaque (generated methods)", detail: `${recvType}.${call.method}` });
        continue;
      }
      const arities = combined.methodArities(recvType, call.method);
      if (arities == null) {
        skipped.push({ filePath: fs.filePath, line: call.line, reason: "receiver type not indexed", detail: `${recvType}.${call.method}` });
      } else if (arities.length === 0) {
        if (!combined.typeHasAnyMethod(recvType)) {
          skipped.push({ filePath: fs.filePath, line: call.line, reason: "receiver type methods not parsed", detail: `${recvType}.${call.method}` });
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

  // 3 — type resolution (warning). A file with a wildcard import cannot know
  // what is in scope, so its unresolved refs are not flagged.
  for (const fs of sug) {
    const wildcard = fs.usings.some((u) => u.endsWith(".*"));
    if (wildcard) {
      if (fs.typeRefs.length > 0) skipped.push({ filePath: fs.filePath, reason: "wildcard import (import pkg.*) — type_resolution not evaluated" });
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

  // 4 — import completeness (warning): a type defined elsewhere IN THIS CHANGE,
  // in a different package, referenced without an explicit import or a matching
  // wildcard import.
  const pkgOfType = new Map<string, string>();
  for (const fs of sug) for (const t of fs.types) if (fs.namespace) pkgOfType.set(t.name, fs.namespace);
  for (const fs of sug) {
    const wildcardPkgs = fs.usings.filter((u) => u.endsWith(".*")).map((u) => u.slice(0, -2));
    const explicit = new Set(fs.usings.filter((u) => !u.endsWith(".*")));
    for (const ref of fs.typeRefs) {
      const pkg = pkgOfType.get(ref.name);
      if (!pkg || pkg === fs.namespace) continue; // undefined-in-change or same package (no import needed)
      if (explicit.has(ref.name) || wildcardPkgs.includes(pkg)) continue;
      findings.push({
        check: "imports",
        severity: "warning",
        filePath: fs.filePath,
        line: ref.line,
        message: `Type ${ref.name} is in package ${pkg} but ${fs.filePath.split("/").pop()} has no matching import.`,
      });
    }
  }

  return { findings, skipped };
}
