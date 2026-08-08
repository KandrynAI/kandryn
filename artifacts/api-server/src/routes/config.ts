import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { clerkClient } from "@clerk/express";
import {
  getAllConfigs,
  saveConfigs,
  deleteConfig,
  getConfig,
  CONFIG_KEYS,
  type ConfigKey,
} from "../services/configService.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// GET /api/config — return all keys with masked values + set status
router.get("/config", async (req, res): Promise<void> => {
  const configs = await getAllConfigs(req.userId);
  res.json(configs);
});

// PUT /api/config — save one or more key→value pairs
const SaveConfigBody = z.object(
  Object.fromEntries(CONFIG_KEYS.map((k) => [k, z.string().optional()])) as Record<
    ConfigKey,
    z.ZodOptional<z.ZodString>
  >,
);

async function handleSaveConfig(req: Request, res: Response): Promise<void> {
  const parsed = SaveConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid config keys" });
    return;
  }
  await saveConfigs(req.userId, parsed.data as Partial<Record<ConfigKey, string>>);
  req.log.info("Integration config updated");
  res.json({ ok: true });
}

router.put("/config", handleSaveConfig);
router.patch("/config", handleSaveConfig);

// DELETE /api/config/:key — clear a single key
router.delete("/config/:key", async (req, res): Promise<void> => {
  const key = req.params.key as ConfigKey;
  if (!CONFIG_KEYS.includes(key)) {
    res.status(400).json({ error: "Unknown config key" });
    return;
  }
  await deleteConfig(req.userId, key);
  res.json({ ok: true });
});

// POST /api/auth/github-sync — pull the user's GitHub OAuth token that Clerk holds
// and upsert it into integration_configs as GITHUB_TOKEN.
//
// Prerequisites: GitHub must be enabled as a social provider in the Replit Auth pane
// (Configure → SSO providers → GitHub → enable). That is a one-time configuration step
// in the workspace Auth pane — no code change is required.
//
// Returns { ok: true, login } on success, { ok: false, reason } when no GitHub OAuth
// token is present (user signed in via a different method) or on error.
router.post("/auth/github-sync", async (req, res): Promise<void> => {
  const userId = req.userId;
  try {
    const result = await clerkClient.users.getUserOauthAccessToken(userId, "oauth_github");
    const token = result.data?.[0]?.token;
    if (!token) {
      res.json({ ok: false, reason: "no_github_oauth" });
      return;
    }

    // No-op if the stored token is already identical — avoids unnecessary DB writes
    const existing = await getConfig(userId, "GITHUB_TOKEN");
    if (existing === token) {
      req.log.info("GitHub token unchanged — skipping sync");
      res.json({ ok: true, noOp: true });
      return;
    }

    // Verify the token is usable and fetch the GitHub login name
    const ghRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "BlueMantis" },
    });
    const login = ghRes.ok ? ((await ghRes.json()) as { login?: string }).login : undefined;
    await saveConfigs(userId, { GITHUB_TOKEN: token });
    req.log.info({ login }, "GitHub token auto-synced from Clerk OAuth");
    res.json({ ok: true, login });
  } catch (err) {
    req.log.warn({ err }, "GitHub OAuth sync failed");
    res.json({ ok: false, reason: "sync_failed" });
  }
});

// GET /api/config/test/:integration — friendly error for browser navigation
router.get("/config/test/:integration", (_req, res): void => {
  res.status(405).json({ error: "Use POST to test a connection" });
});

// Helper: resolve a value from request body, else fall back to user's saved DB value
async function resolve(
  body: Record<string, unknown>,
  bodyKey: string,
  userId: string,
  dbKey: ConfigKey,
): Promise<string> {
  const fromBody = body[bodyKey] as string | undefined;
  if (fromBody && fromBody.trim()) return fromBody.trim();
  return getConfig(userId, dbKey);
}

// POST /api/config/test/:integration — live connection test
router.post("/config/test/:integration", async (req, res): Promise<void> => {
  const integration = req.params.integration;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const uid = req.userId;

  try {
    switch (integration) {
      case "anthropic": {
        const key = await resolve(body, "ANTHROPIC_API_KEY", uid, "ANTHROPIC_API_KEY");
        if (!key) { res.status(400).json({ ok: false, message: "API key not set" }); return; }
        const r = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        });
        if (!r.ok) throw new Error(`Anthropic returned ${r.status}`);
        res.json({ ok: true, message: "Connected to Anthropic successfully" });
        break;
      }

      case "openai": {
        const key = await resolve(body, "OPENAI_API_KEY", uid, "OPENAI_API_KEY");
        if (!key) { res.status(400).json({ ok: false, message: "API key not set" }); return; }
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!r.ok) throw new Error(`OpenAI returned ${r.status}`);
        res.json({ ok: true, message: "Connected to OpenAI successfully" });
        break;
      }

      case "gemini": {
        const key = await resolve(body, "GOOGLE_GEMINI_API_KEY", uid, "GOOGLE_GEMINI_API_KEY");
        if (!key) { res.status(400).json({ ok: false, message: "API key not set" }); return; }
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        );
        if (r.status === 400) throw new Error("Invalid API key format — check you copied the full key from Google AI Studio");
        if (r.status === 403) throw new Error("API key is valid but access is denied — ensure the Generative Language API is enabled in your Google Cloud project");
        if (!r.ok) throw new Error(`Google Gemini returned ${r.status} — check your API key`);
        const data = (await r.json()) as { models?: { name: string }[] };
        const count = Array.isArray(data.models) ? data.models.length : 0;
        res.json({ ok: true, message: `Connected to Google AI — ${count} model${count === 1 ? "" : "s"} available` });
        break;
      }

      case "copilot": {
        const token = await resolve(body, "GITHUB_COPILOT_TOKEN", uid, "GITHUB_COPILOT_TOKEN");
        if (!token) { res.status(400).json({ ok: false, message: "Token not set" }); return; }
        res.json({
          ok: false,
          message: "GitHub Copilot does not expose a public code-generation API — your token is saved and ready for when access becomes available",
        });
        break;
      }

      case "github": {
        const token = await resolve(body, "GITHUB_TOKEN", uid, "GITHUB_TOKEN");
        if (!token) { res.status(400).json({ ok: false, message: "Token not set" }); return; }
        const r = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "RedMantis" },
        });
        if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
        const data = (await r.json()) as { login?: string };
        res.json({ ok: true, message: `Connected as @${data.login}` });
        break;
      }

      case "jira": {
        const domain = await resolve(body, "JIRA_DOMAIN", uid, "JIRA_DOMAIN");
        const email = await resolve(body, "JIRA_EMAIL", uid, "JIRA_EMAIL");
        const token = await resolve(body, "JIRA_API_TOKEN", uid, "JIRA_API_TOKEN");
        if (!domain || !email || !token) {
          res.status(400).json({ ok: false, message: "All three JIRA fields are required" });
          return;
        }
        const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const creds = Buffer.from(`${email}:${token}`).toString("base64");
        const r = await fetch(`https://${cleanDomain}/rest/api/3/myself`, {
          headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
        });
        if (!r.ok) throw new Error(`JIRA returned ${r.status} — check domain, email, and token`);
        const data = (await r.json()) as { displayName?: string; emailAddress?: string };
        res.json({ ok: true, message: `Connected as ${data.displayName ?? data.emailAddress}` });
        break;
      }

      case "azuredevops": {
        const org = await resolve(body, "AZURE_DEVOPS_ORG", uid, "AZURE_DEVOPS_ORG");
        const project = await resolve(body, "AZURE_DEVOPS_PROJECT", uid, "AZURE_DEVOPS_PROJECT");
        const pat = await resolve(body, "AZURE_DEVOPS_PAT", uid, "AZURE_DEVOPS_PAT");
        if (!org || !pat) {
          res.status(400).json({ ok: false, message: "Organisation and PAT are required" });
          return;
        }
        const creds = Buffer.from(`:${pat}`).toString("base64");
        const url = project
          ? `https://dev.azure.com/${org}/${project}/_apis/wit/workitemtypes?api-version=7.1`
          : `https://dev.azure.com/${org}/_apis/projects?api-version=7.1`;
        const r = await fetch(url, {
          headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
        });
        if (!r.ok) throw new Error(`Azure DevOps returned ${r.status} — check org, project, and PAT`);
        res.json({ ok: true, message: `Connected to ${org}${project ? `/${project}` : ""}` });
        break;
      }

      case "azurerepos": {
        const token = await resolve(body, "AZURE_REPOS_TOKEN", uid, "AZURE_REPOS_TOKEN");
        const org = (await resolve(body, "AZURE_REPOS_ORG", uid, "AZURE_REPOS_ORG")).trim();
        if (!token) {
          res.status(400).json({ ok: false, message: "Personal Access Token is required" });
          return;
        }
        if (!org) {
          res.status(400).json({ ok: false, message: "Organisation name is required to test — enter it in the field above" });
          return;
        }
        const creds = Buffer.from(`:${token}`).toString("base64");
        const r = await fetch(
          `https://dev.azure.com/${org}/_apis/git/repositories?api-version=7.1`,
          { headers: { Authorization: `Basic ${creds}`, Accept: "application/json" } },
        );
        if (r.status === 401) throw new Error("Invalid PAT or expired — ensure it has Code → Read & Write scope");
        if (r.status === 403) throw new Error("PAT is valid but lacks permission — ensure it has Code → Read scope for this organisation");
        if (r.status === 404) throw new Error(`Organisation "${org}" not found — check the spelling (it's case-sensitive)`);
        if (!r.ok) throw new Error(`Azure Repos returned ${r.status} — check your organisation name and PAT`);
        const data = (await r.json()) as { value?: { name: string }[] };
        const count = Array.isArray(data.value) ? data.value.length : 0;
        res.json({ ok: true, message: `Connected to ${org} — ${count} repositor${count === 1 ? "y" : "ies"} found` });
        break;
      }

      case "confluence": {
        const domain = (await resolve(body, "CONFLUENCE_DOMAIN", uid, "CONFLUENCE_DOMAIN")).trim();
        const email = (await resolve(body, "CONFLUENCE_EMAIL", uid, "CONFLUENCE_EMAIL")).trim();
        const token = await resolve(body, "CONFLUENCE_API_TOKEN", uid, "CONFLUENCE_API_TOKEN");
        if (!domain || !email || !token) {
          res.status(400).json({ ok: false, message: "Domain, email, and API token are required" });
          return;
        }
        const auth = Buffer.from(`${email}:${token}`).toString("base64");
        const r = await fetch(`https://${domain}/wiki/rest/api/space?limit=1`, {
          headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        });
        if (r.status === 401) throw new Error("Invalid email or API token");
        if (!r.ok) throw new Error(`Confluence returned ${r.status} — check your domain and credentials`);
        res.json({ ok: true, message: `Connected to ${domain}` });
        break;
      }

      case "notion": {
        const token = await resolve(body, "NOTION_API_TOKEN", uid, "NOTION_API_TOKEN");
        if (!token) {
          res.status(400).json({ ok: false, message: "Notion API token is required" });
          return;
        }
        const r = await fetch("https://api.notion.com/v1/users/me", {
          headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
        });
        if (r.status === 401) throw new Error("Invalid Notion token");
        if (!r.ok) throw new Error(`Notion returned ${r.status}`);
        res.json({ ok: true, message: "Notion integration connected" });
        break;
      }

      default:
        res.status(404).json({ ok: false, message: "Unknown integration" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    logger.warn({ integration, err }, "Integration test failed");
    res.status(400).json({ ok: false, message });
  }
});

export default router;
