import type { StackProfile } from "../stack/detector.js";

/**
 * Build the stack-aware instruction block prepended to the shared generation
 * prompt so Raptia and Fovea target the repo's exact language, framework, and
 * conventions. Returns "" when no stack is known (graceful no-op — the prompt is
 * unchanged from the stack-agnostic default).
 */
export function buildStackAwarePrompt(stack: StackProfile | null): string {
  if (!stack) return "";

  const parts: string[] = [];

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
