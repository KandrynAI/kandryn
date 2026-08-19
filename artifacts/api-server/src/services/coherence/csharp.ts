import type { CoherenceSkip } from "../../../../../shared/types/coherence.js";

// ---------------------------------------------------------------------------
// C# symbol extraction (pattern-based, v1). Deliberately conservative: an idiom
// the regex was not built for is RECORDED as a skip and not evaluated, never
// guessed — a false positive on a correct multi-file change erodes trust in the
// score far more than missing an occasional real issue.
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

// C# BCL / framework types the checker treats as always-resolvable.
const BCL = new Set([
  "void", "var", "object", "string", "int", "long", "short", "byte", "bool", "char", "float", "double", "decimal",
  "Task", "ValueTask", "Guid", "DateTime", "DateTimeOffset", "TimeSpan", "Exception", "Type", "Nullable",
  "List", "IList", "IEnumerable", "ICollection", "IReadOnlyList", "IReadOnlyCollection", "Dictionary", "IDictionary",
  "HashSet", "ISet", "Array", "Span", "Memory", "Queue", "Stack", "Tuple", "KeyValuePair", "Func", "Action", "Predicate",
  "IActionResult", "ActionResult", "IQueryable", "DbSet", "CancellationToken", "JsonSerializer", "StringComparison",
  "Uri", "Stream", "Regex", "StringBuilder", "IConfiguration", "ILogger", "HttpClient", "HttpContext",
]);
// Statement keywords that look like calls but are not method invocations.
const CALL_KEYWORDS = new Set(["if", "for", "foreach", "while", "switch", "catch", "using", "lock", "fixed", "return", "await", "nameof", "typeof", "sizeof", "new"]);
const METHOD_KEYWORDS = CALL_KEYWORDS;
// Words that appear where a return type would sit in `return Foo(x);` etc. — a
// statement, not a method declaration.
const STMT_RETURN_TYPES = new Set(["return", "await", "throw", "yield", "else", "in", "is", "as", "out", "ref", "case", "goto"]);

const baseId = (t: string): string => t.replace(/<.*$/, "").replace(/\[.*$/, "").replace(/\?+$/, "").trim();
const isPascal = (s: string): boolean => /^[A-Z][A-Za-z0-9_]*$/.test(s);
const isBcl = (name: string): boolean => BCL.has(baseId(name));

/** Count top-level (bracket-depth-0) comma-separated params. "" → 0. */
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

const TYPE_DECL = /^\s*(?:\[[^\]]*\]\s*)*(?:public|internal|private|protected|abstract|sealed|static|partial|\s)*\b(class|interface|record|struct|enum)\s+([A-Za-z_]\w*)\s*(<[^>]*>)?\s*(\([^)]*\))?\s*(?::\s*([^\{;]+?))?\s*(?:\{|;|$)/;
// A method DECLARATION: `mods returnType Name(params)` followed by a body start
// (`{`, `=>`, `;`) or end-of-line (Allman brace on the next line). The two-token
// `returnType Name(` shape excludes bare calls like `Foo(x)`.
const METHOD_DECL = /^\s*(?:\[[^\]]*\]\s*)*((?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|new|extern|unsafe|\s)*)\b([\w<>\[\],\.\?]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?=\{|=>|;|$)/;
const FIELD_DECL = /^\s*(?:\[[^\]]*\]\s*)*(?:public|private|protected|internal|readonly|static|const|required|\s)*\b([\w<>\[\],\.\?]+)\s+(_?[A-Za-z]\w*)\s*(?:=>|=|\{\s*get|;)/;
const USING = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/;
const NAMESPACE = /^\s*namespace\s+([\w.]+)\s*[;{]?/;
const CALL = /(?:(\b_?[A-Za-z]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\(/g;

/** Extract C# symbols from one file. Conservative — unparseable constructs are skipped, not guessed. */
export function extractCSharpSymbols(filePath: string, content: string): FileSymbols {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const sym: FileSymbols = { filePath, namespace: null, usings: [], types: [], fields: [], calls: [], typeRefs: [], skipped: [] };

  // Track the current type by brace depth so methods/fields attach correctly.
  let depth = 0;
  const typeStack: Array<{ type: TypeSig; openDepth: number; entered: boolean }> = [];
  const currentType = () => (typeStack.length ? typeStack[typeStack.length - 1].type : null);
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\/\/.*$/, ""); // strip line comments (crude)
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (/\/\*/.test(line) && !/\*\//.test(line)) inBlockComment = true;
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const uMatch = USING.exec(line);
    if (uMatch) sym.usings.push(uMatch[1]);
    if (!sym.namespace) {
      const nMatch = NAMESPACE.exec(line);
      if (nMatch) sym.namespace = nMatch[1];
    }

    const tMatch = TYPE_DECL.exec(line);
    if (tMatch) {
      const [, kind, name, , primaryCtor, baseList] = tMatch;
      const bases = baseList ? baseList.split(",").map((b) => baseId(b)).filter(Boolean) : [];
      const type: TypeSig = { kind: kind as TypeSig["kind"], name, bases, methods: [], line: lineNo };
      sym.types.push(type);
      if (primaryCtor) sym.skipped.push({ filePath, line: lineNo, reason: "primary constructor", detail: `${name}${primaryCtor}` });
      // Push; the body is entered at the opening brace (this line or a later one,
      // handled by the shared brace bookkeeping at the end of the loop).
      typeStack.push({ type, openDepth: depth, entered: false });
    }

    // Method / field only make sense inside a type, and never on its decl line.
    const ct = tMatch ? null : currentType();
    const mMatch = ct ? METHOD_DECL.exec(line) : null;
    let isDeclLine = false;
    if (ct) {
      // A signature whose "(" opens but does not close on this line — don't
      // guess the arity, record the blind spot instead.
      const opensParen = /\b[A-Za-z_]\w*\s*\([^)]*$/.test(trimmed);
      if (opensParen && !/\)/.test(trimmed)) {
        sym.skipped.push({ filePath, line: lineNo, reason: "multi-line signature", detail: trimmed.slice(0, 80) });
      } else if (mMatch) {
        const [, mods, returnType, name, params] = mMatch;
        if (!METHOD_KEYWORDS.has(name) && name !== ct.name && !STMT_RETURN_TYPES.has(baseId(returnType))) {
          isDeclLine = true;
          const arity = countArity(params);
          if (arity == null) sym.skipped.push({ filePath, line: lineNo, reason: "unparseable parameter list", detail: trimmed.slice(0, 80) });
          else ct.methods.push({ name, arity, line: lineNo, isPublic: /\bpublic\b/.test(mods) });
        }
      } else {
        const fMatch = FIELD_DECL.exec(line);
        if (fMatch && !fMatch[1].includes("(")) {
          sym.fields.push({ name: fMatch[2], typeName: baseId(fMatch[1]) });
          const tRef = baseId(fMatch[1]);
          if (isPascal(tRef)) sym.typeRefs.push({ name: tRef, line: lineNo });
        }
      }
    }

    // Method calls in bodies (best-effort; receiver resolved later via fields).
    // Skip declaration lines so a method's own name is not read as a call.
    if (!isDeclLine && !tMatch) {
      for (const c of line.matchAll(CALL)) {
        const method = c[2];
        if (METHOD_KEYWORDS.has(method)) continue;
        sym.calls.push({ receiver: c[1] ?? null, method, arity: null, line: lineNo });
      }
      // `new Type(` references.
      for (const n of line.matchAll(/\bnew\s+([A-Z]\w*)/g)) sym.typeRefs.push({ name: n[1], line: lineNo });
    }

    // Shared brace bookkeeping: enter a type's body once depth passes its open
    // depth (handles Allman braces on the next line); pop once it returns.
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    const top = typeStack[typeStack.length - 1];
    if (top && depth > top.openDepth) top.entered = true;
    while (typeStack.length && typeStack[typeStack.length - 1].entered && depth <= typeStack[typeStack.length - 1].openDepth) typeStack.pop();
  }

  return sym;
}
