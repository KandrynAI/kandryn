export type StackProfile = {
  frontend: string;
  backend: string;
  database: string;
  language: string;
  testFramework: string;
  packageManager: string;
};

/** Reads a file's text by repo path; returns null when unavailable/binary. */
export type ReadFile = (path: string) => Promise<string | null>;

// Files whose *contents* carry stack signals the filenames don't: the DB
// provider and test framework live inside these, not in path names.
function isSignalFile(path: string): boolean {
  const p = path.toLowerCase();
  const base = p.split("/").pop() ?? p;
  return (
    p.endsWith(".csproj") ||
    base === "program.cs" ||
    base === "startup.cs" ||
    base === "package.json" ||
    base === "requirements.txt" ||
    (base.startsWith("appsettings") && base.endsWith(".json"))
  );
}

// Cap how much we read so a huge repo can't blow up detection.
const MAX_SIGNAL_FILES = 25;
const MAX_CONTENT_CHARS = 20_000;

/**
 * Detect a repository's stack from its file list, and — when a content reader
 * is supplied — from the contents of a few signal files (appsettings*.json,
 * *.csproj, Program.cs, package.json, requirements.txt). Database and test
 * framework live in file *contents* (EF Core `UseSqlServer(...)`, xunit
 * `<PackageReference>`), invisible to a filename-only pass, so those two are
 * content-aware. Database falls back to "unknown" (never a silent "postgresql"
 * guess) — the run pipeline conditions on it, and a wrong value makes agents
 * generate code against the wrong data layer.
 */
export async function detectStack(filePaths: string[], readFile?: ReadFile): Promise<StackProfile> {
  const has = (pattern: string) => filePaths.some((f) => f.toLowerCase().includes(pattern));

  // Gather signal-file contents (best-effort; missing/binary files are skipped).
  let content = "";
  if (readFile) {
    const signalPaths = filePaths.filter(isSignalFile).slice(0, MAX_SIGNAL_FILES);
    const texts = await Promise.all(
      signalPaths.map((p) => readFile(p).catch(() => null)),
    );
    content = texts
      .filter((t): t is string => Boolean(t))
      .map((t) => t.slice(0, MAX_CONTENT_CHARS))
      .join("\n")
      .toLowerCase();
  }
  const inContent = (needle: string) => content.includes(needle);

  const database =
    inContent("npgsql") || inContent("usenpgsql")
      ? "postgresql"
      : inContent("usesqlserver") ||
          inContent("sqlserver") ||
          inContent("data.sqlclient") ||
          inContent("mssql")
        ? "sqlserver"
        : inContent("pomelo.entityframeworkcore.mysql") ||
            inContent("usemysql") ||
            inContent("mysqlconnector") ||
            inContent("mysql")
          ? "mysql"
          : inContent("usesqlite") || inContent("microsoft.data.sqlite") || inContent("sqlite")
            ? "sqlite"
            : inContent("oracle")
              ? "oracle"
              : // Fall back to path hints, then to an honest "unknown".
                has("sqlserver") || has("mssql")
                ? "sqlserver"
                : has("mysql")
                  ? "mysql"
                  : has("oracle") || has("tns")
                    ? "oracle"
                    : "unknown";

  const testFramework =
    has(".spec.ts")
      ? "jasmine"
      : has(".test.ts") || has("jest.config")
        ? "jest"
        : inContent("xunit")
          ? "xunit"
          : inContent("nunit")
            ? "nunit"
            : inContent("mstest") || inContent("microsoft.visualstudio.testtools")
              ? "mstest"
              : // Path fallbacks.
                has("xunit")
                ? "xunit"
                : has("junit")
                  ? "junit"
                  : has("pytest")
                    ? "pytest"
                    : "none";

  return {
    frontend: has("angular.json")
      ? "angular"
      : has("vue.config")
        ? "vue"
        : has("package.json")
          ? "react"
          : "none",

    backend: has(".csproj")
      ? "dotnet"
      : has("pom.xml")
        ? "java-spring"
        : has("build.gradle")
          ? "java-spring"
          : has("requirements.txt")
            ? "python"
            : "nodejs",

    database,

    language: has(".csproj")
      ? "csharp"
      : has("pom.xml") || has("build.gradle")
        ? "java"
        : has("requirements.txt")
          ? "python"
          : has("tsconfig.json")
            ? "typescript"
            : "javascript",

    testFramework,

    packageManager: has(".csproj")
      ? "nuget"
      : has("pom.xml")
        ? "maven"
        : has("build.gradle")
          ? "gradle"
          : has("requirements.txt")
            ? "pip"
            : has("yarn.lock")
              ? "yarn"
              : "npm",
  };
}
