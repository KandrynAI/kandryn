import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  tasksTable,
  projectsTable,
  repositoriesTable,
  runsTable,
  suggestionsTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { getConfigs } from "../services/configService.js";
import { GitService } from "../services/gitService.js";
import { generateTests, AIFormatError } from "../services/aiService.js";
import { createPlmTestCase } from "../services/plmWrite.js";
import { PlmError } from "../services/plmProjects.js";
import type { StackProfile } from "../stack/detector.js";
import * as audit from "../services/auditService.js";

const router: IRouter = Router();

const IdParam = z.object({ id: z.coerce.number().int().positive() });

type Context =
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      workItem: typeof tasksTable.$inferSelect;
      project: typeof projectsTable.$inferSelect;
      repo: typeof repositoriesTable.$inferSelect | undefined;
    };

// Load the work item (user-scoped), its project, and repo in one place.
async function loadContext(userId: string, workItemId: number): Promise<Context> {
  const [workItem] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, workItemId), eq(tasksTable.userId, userId)));
  if (!workItem) return { ok: false, status: 404, message: "Work item not found" };
  if (workItem.projectId == null) {
    return { ok: false, status: 422, message: "Work item is not attached to a project." };
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, workItem.projectId));
  if (!project) return { ok: false, status: 404, message: "Project not found." };

  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(eq(repositoriesTable.id, project.repositoryId));

  return { ok: true, workItem, project, repo };
}

// The most recent committed run for a work item, plus its chosen suggestion.
async function latestCommittedRun(userId: string, workItemId: number) {
  const [run] = await db
    .select()
    .from(runsTable)
    .where(
      and(
        eq(runsTable.userId, userId),
        eq(runsTable.workItemId, workItemId),
        isNotNull(runsTable.commitHash),
      ),
    )
    .orderBy(desc(runsTable.createdAt))
    .limit(1);
  if (!run) return null;

  let suggestion: typeof suggestionsTable.$inferSelect | undefined;
  if (run.committedSuggestionId != null) {
    [suggestion] = await db
      .select()
      .from(suggestionsTable)
      .where(eq(suggestionsTable.id, run.committedSuggestionId));
  }
  if (!suggestion) {
    // Fallback: highest-scored suggestion of that run.
    [suggestion] = await db
      .select()
      .from(suggestionsTable)
      .where(eq(suggestionsTable.runId, run.id))
      .orderBy(desc(suggestionsTable.score))
      .limit(1);
  }
  return { run, suggestion };
}

// ---------------------------------------------------------------------------
// POST /work-items/:id/tests/generate — Given/When/Then cases + a test script.
// Proposals only; nothing is committed or pushed here (spec §3.4 / §6).
// ---------------------------------------------------------------------------
router.post("/work-items/:id/tests/generate", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }
  const ctx = await loadContext(req.userId, params.data.id);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.message });
    return;
  }
  const { workItem, repo } = ctx;

  const committed = await latestCommittedRun(req.userId, workItem.id);
  if (!committed || !committed.suggestion) {
    res.status(422).json({ error: "Commit a suggestion for this work item before generating tests." });
    return;
  }

  const creds = await getConfigs(req.userId, ["ANTHROPIC_API_KEY"]);
  if (!creds.ANTHROPIC_API_KEY) {
    res.status(424).json({ error: "Add your Anthropic API key in Integrations to generate tests." });
    return;
  }

  const stack = (repo?.stackProfile as StackProfile) ?? null;
  try {
    const tests = await generateTests(
      {
        title: workItem.title,
        acceptanceCriteria: workItem.acceptanceCriteria
          ? workItem.acceptanceCriteria.split(/\n/).map((s) => s.trim()).filter(Boolean)
          : [],
        suggestionCode: committed.suggestion.code,
        suggestionExplanation: committed.suggestion.explanation,
        framework: stack?.testFramework ?? "",
      },
      { anthropicApiKey: creds.ANTHROPIC_API_KEY },
      stack,
    );
    // Persist the rich cases + script on the committed suggestion so the run
    // detail can rehydrate them (show generated tests, regenerate, push). A
    // (re)generate replaces both and clears any prior per-case push status.
    await db
      .update(suggestionsTable)
      .set({
        testCases: tests.testCases,
        testScript: {
          filePath: tests.testScript.filePath,
          code: tests.testScript.code,
          framework: tests.testScript.framework,
        },
      })
      .where(eq(suggestionsTable.id, committed.suggestion.id));

    req.log.info({ workItemId: workItem.id, cases: tests.testCases.length }, "Tests generated");
    res.json(tests);
  } catch (err) {
    if (err instanceof AIFormatError) {
      res.status(422).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /work-items/:id/tests/commit-script — commit the test script to the
// SAME branch as the implementation PR (adds a commit to the open PR; no new
// PR). Reuses the run-commit branch convention `task/<workItemId>` (spec §3.4).
// ---------------------------------------------------------------------------
const CommitScriptBody = z.object({
  filePath: z.string().min(1).max(300),
  code: z.string().min(1),
});

router.post("/work-items/:id/tests/commit-script", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }
  const parsed = CommitScriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }
  const ctx = await loadContext(req.userId, params.data.id);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.message });
    return;
  }
  const { workItem, repo } = ctx;
  if (!repo) {
    res.status(422).json({ error: "Project has no repository." });
    return;
  }

  const committed = await latestCommittedRun(req.userId, workItem.id);
  if (!committed) {
    res.status(422).json({ error: "Commit a suggestion for this work item before adding tests." });
    return;
  }

  const gitCreds = await getConfigs(req.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  const git = await GitService.forRepo(repo.id, {
    githubToken: gitCreds.GITHUB_TOKEN,
    azureReposToken: gitCreds.AZURE_REPOS_TOKEN,
  });
  const branchName = `task/${workItem.id}`;

  // Stack the test commit ON the branch's current HEAD so the implementation
  // commit is preserved and both show up in the existing PR.
  const headSha = await git.branchHeadSha(branchName);
  const commitHash = await git.commitChanges({
    branchName,
    baseSha: headSha,
    message: `Blue Mantis: tests for ${workItem.title}`,
    files: [{ path: parsed.data.filePath, content: parsed.data.code }],
  });

  req.log.info({ workItemId: workItem.id, commitHash }, "Test script committed to branch");
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "tests.committed",
    entityType: "run",
    entityId: committed.run.id,
    metadata: { workItemId: workItem.id, commitHash },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.json({ commitHash, prUrl: committed.run.prUrl });
});

// ---------------------------------------------------------------------------
// POST /work-items/:id/tests/push — push selected cases to the PLM and mirror
// them locally as test_case items under the parent (spec §3.4 / §6).
// ---------------------------------------------------------------------------
const PushTestsBody = z.object({
  testCases: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(200),
        given: z.string().optional(),
        when: z.string().optional(),
        then: z.string().optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        type: z.enum(["happy-path", "edge-case", "failure"]).optional(),
        assertion: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(30),
});

router.post("/work-items/:id/tests/push", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }
  const parsed = PushTestsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }
  const ctx = await loadContext(req.userId, params.data.id);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.message });
    return;
  }
  const { workItem, project } = ctx;
  if (!workItem.externalId || (workItem.source !== "jira" && workItem.source !== "azure-devops")) {
    res.status(422).json({ error: "This work item isn't linked to a PLM story, so test cases can't be pushed." });
    return;
  }

  // The committed suggestion carries the persisted test cases; we write the
  // per-case push status (plmKey/plmUrl) back onto it so the run detail shows
  // each case as "Pushed" across reloads.
  const committed = await latestCommittedRun(req.userId, workItem.id);
  const persistPushStatus = async (
    results: { testCaseId: string; plmUrl: string; plmKey: string }[],
  ): Promise<void> => {
    if (!committed?.suggestion || results.length === 0) return;
    const byId = new Map(results.map((r) => [r.testCaseId, r]));
    const merged = (committed.suggestion.testCases ?? []).map((c) => {
      const hit = byId.get(c.id);
      return hit ? { ...c, plmKey: hit.plmKey, plmUrl: hit.plmUrl } : c;
    });
    await db.update(suggestionsTable).set({ testCases: merged }).where(eq(suggestionsTable.id, committed.suggestion.id));
  };

  const pushed: { testCaseId: string; plmUrl: string; plmKey: string }[] = [];
  try {
    for (let i = 0; i < parsed.data.testCases.length; i++) {
      const tc = parsed.data.testCases[i];
      const testCaseId = tc.id ?? `tc-${String(i + 1).padStart(3, "0")}`;
      const result = await createPlmTestCase(
        req.userId,
        { plmProvider: project.plmProvider, plmProjectKey: project.plmProjectKey },
        { ...tc, parentExternalId: workItem.externalId },
        req.teamId ?? null,
      );
      // Mirror locally as a test_case under the parent. externalId set so a
      // later sync upserts rather than duplicates.
      await db.insert(tasksTable).values({
        userId: req.userId,
        projectId: project.id,
        repositoryId: project.repositoryId,
        externalId: result.externalId,
        source: project.plmProvider,
        type: "task",
        itemType: "test_case",
        title: tc.title,
        description:
          [
            (tc.priority || tc.type) && `${tc.priority ?? ""}${tc.priority && tc.type ? " · " : ""}${tc.type ?? ""}`.trim(),
            tc.given && `Given: ${tc.given}`,
            tc.when && `When: ${tc.when}`,
            tc.then && `Then: ${tc.then}`,
            tc.assertion && `Assert: ${tc.assertion}`,
          ]
            .filter(Boolean)
            .join("\n") || null,
        priority: tc.priority === "high" ? "high" : tc.priority === "low" ? "low" : "medium",
        status: "open",
        parentId: workItem.id,
        plmUrl: result.plmUrl,
      });
      pushed.push({ testCaseId, plmUrl: result.plmUrl, plmKey: result.externalId });
    }
  } catch (err) {
    if (err instanceof PlmError) {
      // Persist whatever succeeded before the failure so their status sticks.
      await persistPushStatus(pushed);
      res.status(err.code === "not_connected" ? 424 : 502).json({ error: err.message, pushed });
      return;
    }
    throw err;
  }

  await persistPushStatus(pushed);
  req.log.info({ workItemId: workItem.id, count: pushed.length }, "Test cases pushed to PLM");
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "tests.pushed_to_plm",
    entityType: "run",
    entityId: committed?.run.id,
    metadata: { workItemId: workItem.id, count: pushed.length },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.json({ pushed });
});

export default router;
