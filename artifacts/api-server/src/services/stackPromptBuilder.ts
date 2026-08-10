import type { StackProfile } from "../stack/detector.js";

const KARPATHY_RUNTIME_SECTION = `
CODING BEHAVIOUR — follow all four rules on every suggestion:

RULE 1 — THINK BEFORE CODING
Before writing code, consider whether the acceptance criteria
are complete and unambiguous. If any criterion is vague,
contradictory, or could be interpreted in more than one way:
  - Name the ambiguity explicitly in your explanation
  - State the interpretation you chose and why
  - Do not silently assume — surface the uncertainty
If the criteria cannot be fully implemented in a single file
change (e.g. requires a config change, environment variable,
or a second file), say so in your explanation.

RULE 2 — SIMPLICITY FIRST
Write the minimum code that satisfies the acceptance criteria.
Nothing else.
  - No helper functions that are not called by this change
  - No abstractions for code used only once
  - No error handling for scenarios not mentioned in the criteria
  - No "while I'm here" additions
  - No configurability that was not asked for
If 20 lines solves it, do not write 60.
The test: does every line of your suggestion trace to a specific
acceptance criterion? If a line does not, remove it.

RULE 3 — SURGICAL CHANGES
Modify only the files and functions directly required by the
work item. Leave everything else exactly as it is.
  - Do not rename variables or functions not part of the task
  - Do not reformat or re-indent adjacent code
  - Do not refactor things that are not broken
  - Do not fix other bugs you notice in the file
  - Match the existing code style even if you would do it differently
Every changed line must be explainable by the work item.

RULE 4 — MAP YOUR CODE TO THE CRITERIA
In your explanation, explicitly state which part of your code
addresses which acceptance criterion.
Use this format:
  "Criterion 1 (idempotency check): lines 14-18 — the existing
   row lookup before insert."
  "Criterion 2 (400 on missing key): line 8 — the header check."
If a criterion is fully addressed: mark it covered.
If a criterion is partially addressed: say what is missing.
If a criterion is not addressed by code (e.g. needs a deploy
config change): say so explicitly.
`;

/**
 * Build the instruction block prepended to the shared generation prompt. Always
 * includes the Karpathy runtime coding-behaviour rules; when a stack is known it
 * also appends the repo's exact language/framework/conventions. Never returns ""
 * — even undetected-stack customers get the behaviour rules.
 */
export function buildStackAwarePrompt(stack: StackProfile | null): string {
  const parts: string[] = [];

  // Karpathy runtime principles — always first so the model anchors on
  // behaviour before reading the stack or work item.
  parts.push(KARPATHY_RUNTIME_SECTION);
  parts.push("");

  if (!stack) return parts.join("\n");

  const frontendInstructions: Record<string, string> = {
    react:
      "Generate a React 18+ functional component with TypeScript. " +
      "Use hooks (useState, useEffect, useMemo, useCallback) as appropriate. " +
      "No class components. Export as a named export unless it is a page.",
    angular:
      "Generate an Angular 17+ standalone component with TypeScript. " +
      "Use signals and the inject() function for dependency injection. " +
      "Use the new control flow syntax (@if, @for) not *ngIf/*ngFor.",
    vue:
      "Generate a Vue 3 single-file component with <script setup> and " +
      "TypeScript Composition API. Use defineProps, defineEmits, and ref/computed.",
    none: "",
  };

  const backendInstructions: Record<string, string> = {
    nodejs:
      "Generate a Node.js / Express route handler or service with TypeScript " +
      "and async/await. Follow the existing Express 5 patterns in the codebase. " +
      "Never use console.log — use the req.log pino logger.",
    dotnet:
      "Generate a C# .NET 8 minimal API endpoint or controller following REST " +
      "conventions. Use record types for DTOs. Prefer async/await throughout. " +
      "Follow existing namespace conventions in the repository.",
    "java-spring":
      "Generate a Java Spring Boot 3 REST controller or service class. " +
      "Use constructor injection (not field injection). Add appropriate " +
      "annotations (@RestController, @Service, @GetMapping etc.). " +
      "Use records or Lombok for DTOs if the codebase already uses them.",
    python:
      "Generate a Python FastAPI or Django REST endpoint with full type hints. " +
      "Use Pydantic models for request/response validation. " +
      "Follow the existing module structure in the repository.",
  };

  const dbInstructions: Record<string, string> = {
    postgresql:
      "Use standard SQL or the ORM already in use (Drizzle / SQLAlchemy / " +
      "Hibernate / Entity Framework). Avoid database-specific functions " +
      "not supported by PostgreSQL.",
    sqlserver:
      "Use T-SQL syntax. Avoid PostgreSQL-specific functions (use ISNULL " +
      "not COALESCE where they differ, TOP not LIMIT, etc.).",
    oracle:
      "Use Oracle SQL / PL/SQL syntax. Use ROWNUM or FETCH FIRST n ROWS ONLY " +
      "instead of LIMIT. Use sequences for auto-increment. " +
      "Avoid ANSI functions not supported by Oracle 19c+.",
    mysql:
      "Use MySQL 8 syntax. Use LIMIT for pagination. " +
      "Avoid PostgreSQL-specific extensions.",
  };

  const testInstructions: Record<string, string> = {
    jest:
      "If writing tests, use Jest with TypeScript. " +
      "Use describe/it/expect. Mock with jest.fn() and jest.spyOn().",
    jasmine:
      "If writing tests, use Jasmine syntax. " +
      "Use describe/it/expect with Jasmine matchers.",
    xunit:
      "If writing tests, use xUnit with C#. " +
      "Use [Fact] and [Theory] attributes. Assert with Assert.Equal.",
    junit:
      "If writing tests, use JUnit 5 with @Test annotations. " +
      "Use Mockito for mocking.",
    pytest:
      "If writing tests, use pytest. Use fixtures and parametrize. " +
      "Mock with unittest.mock or pytest-mock.",
    none: "",
  };

  const packageManagerNote: Record<string, string> = {
    npm: "Import new dependencies using npm syntax.",
    yarn: "Import new dependencies using yarn syntax.",
    maven: "Add any new dependencies as Maven coordinates in pom.xml.",
    gradle: "Add any new dependencies to build.gradle.",
    nuget: "Add any new dependencies via NuGet package references.",
    pip: "Add any new dependencies to requirements.txt.",
  };

  parts.push("REPOSITORY STACK — follow these conventions exactly:");
  parts.push("");

  if (stack.frontend && stack.frontend !== "none") {
    const instruction = frontendInstructions[stack.frontend];
    if (instruction) parts.push(`Frontend (${stack.frontend}): ${instruction}`);
  }
  if (stack.backend) {
    const instruction = backendInstructions[stack.backend];
    if (instruction) parts.push(`Backend (${stack.backend}): ${instruction}`);
  }
  if (stack.database) {
    const instruction = dbInstructions[stack.database];
    if (instruction) parts.push(`Database (${stack.database}): ${instruction}`);
  }
  if (stack.testFramework && stack.testFramework !== "none") {
    const instruction = testInstructions[stack.testFramework];
    if (instruction) parts.push(`Tests (${stack.testFramework}): ${instruction}`);
  }
  if (stack.packageManager) {
    const note = packageManagerNote[stack.packageManager];
    if (note) parts.push(`Package manager: ${note}`);
  }
  if (stack.language) {
    parts.push(
      `Language: All code must be written in ${stack.language}. ` +
        `Match the style and conventions already present in the repository files provided.`,
    );
  }

  parts.push("");
  parts.push(
    "Do not introduce a new language, framework, or pattern that is not " +
      "already present in the repository files above. " +
      "Match existing naming conventions, file structure, and import style exactly.",
  );
  parts.push("");

  return parts.join("\n");
}

/** Human-readable one-line stack summary (run info strip, logs, run.stackDesc). */
export function describeStack(stack: StackProfile | null): string {
  if (!stack) return "Unknown stack";
  const parts: string[] = [];
  if (stack.frontend && stack.frontend !== "none") parts.push(stack.frontend);
  if (stack.backend) parts.push(stack.backend);
  if (stack.database) parts.push(stack.database);
  if (stack.language) parts.push(stack.language);
  return parts.join(" · ");
}
