import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The guard #101's regex could not be: a source-level check that there is still
 * exactly ONE place that decides which project you are in.
 *
 * RESOURCE_ROUTE_RE catches a *page* that renders a project-owned resource and
 * forgets to publish its project. It cannot catch what actually broke the Board
 * icon: a *nav control* that built a `/p/:id` href from its own private guess.
 * Those are different failure modes, and the second one had shipped twice — the
 * command rail and the dashboard tiles — before anyone noticed.
 *
 * Both rules below are about the same tell. Reaching for the whole project list
 * outside the provider means you are about to guess which project the user is
 * in, and every such guess has eventually disagreed with the provider.
 *
 * If a new file trips one of these, the fix is almost always to call
 * useActiveProject(). Adding it to an allowlist is the exception, and the
 * comment beside its entry has to say why.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Files permitted to load the whole project list. Each is here because it does
 * NOT resolve an active project from it.
 */
const FETCH_PROJECTS_ALLOWED = new Set([
  // The one derivation. Everything else reads its result.
  "context/ActiveProjectContext.tsx",
  // Looks a project up BY the id already in the URL, for the page title. Never
  // falls back, so it cannot disagree with the provider.
  "components/layout/TopBar.tsx",
  // Populates the reports scope <select>; the user picks explicitly.
  "pages/ReportsPage.tsx",
  // Declares the endpoint.
  "services/api.ts",
]);

/** Files permitted to pick a project by list position. */
const FIRST_PROJECT_ALLOWED = new Set(["lib/activeProject.ts"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments before matching. Otherwise the guard fires on any comment that
 * merely DESCRIBES the pattern — including the ones left at each call site
 * explaining why the old fallback was wrong. The `[^:]` lookbehind keeps
 * `https://` intact.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC).map((full) => ({
  rel: relative(SRC, full).split(sep).join("/"),
  text: stripComments(readFileSync(full, "utf8")),
}));

test("the source tree is non-empty (the guard is actually reading files)", () => {
  // Without this, a broken path would make every rule below pass vacuously.
  assert.ok(files.length > 20, `expected the dev-copilot sources, found ${files.length} files`);
});

test("only the provider loads the whole project list", () => {
  const offenders = files
    .filter((f) => /\bfetchProjects\s*\(/.test(f.text))
    .map((f) => f.rel)
    .filter((rel) => !FETCH_PROJECTS_ALLOWED.has(rel));

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} loads every project. If it needs to know which project the user is in, ` +
      `call useActiveProject() — a second resolution has diverged from the provider every time. ` +
      `If it genuinely does not resolve an active project, add it to FETCH_PROJECTS_ALLOWED with a reason.`,
  );
});

test("only the pure resolver picks a project by list position", () => {
  // `projects[0]`, `ps[0]?.id`, `list[0] ?? null` — the ambient-guess fallback.
  const FIRST_OF_LIST = /\b(projects|ps|projectList)\s*\[\s*0\s*\]/;
  const offenders = files
    .filter((f) => FIRST_OF_LIST.test(f.text))
    .map((f) => f.rel)
    .filter((rel) => !FIRST_PROJECT_ALLOWED.has(rel));

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} falls back to the first project. That is the oldest project by created_at, ` +
      `not the one the user is working in. resolveActiveProject already owns this fallback — read the ` +
      `active project from useActiveProject() instead.`,
  );
});

test("nothing builds a /p/:id href from an ad-hoc project id", () => {
  // A project-scoped href is fine when the id comes from this file's own route
  // params or a specific entity (`p.id`, `project.id`, `run.projectId`). It is
  // not fine when the id is an ambient "which project am I in" guess, which is
  // what `activeId` was in the rail. Anything building such an href must either
  // take the id from the provider or from something it can name.
  const AMBIENT_HREF = /`\/p\/\$\{\s*(activeId|activeProjectId|currentProjectId)\b/;
  const offenders = files
    .filter((f) => AMBIENT_HREF.test(f.text))
    .filter((f) => !/useActiveProject\s*\(/.test(f.text))
    .map((f) => f.rel);

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} builds a project-scoped link from an ambient project id without reading it ` +
      `from useActiveProject(). Clicking a nav control must mean "the project I am currently working in".`,
  );
});
