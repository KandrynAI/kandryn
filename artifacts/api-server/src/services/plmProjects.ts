import { getConfigs } from "./configService.js";

/**
 * Lists / validates PLM projects for the project-creation wizard and the live
 * binding check on POST /api/projects. Reuses the same auth as the PLM adapters
 * (Jira: Basic email:token at {domain}/rest/api/3; ADO: Basic :pat at
 * dev.azure.com/{org}). Tracker credentials are team-level, so callers pass the
 * user's teamId and getConfigs resolves team-first then personal.
 */

export type PlmProvider = "jira" | "azure-devops";
export interface PlmProjectRef {
  key: string;
  name: string;
}

/** Distinguishes "credentials not connected" from a live PLM API failure. */
export class PlmError extends Error {
  constructor(
    message: string,
    public code: "not_connected" | "unreachable" = "unreachable",
  ) {
    super(message);
    this.name = "PlmError";
  }
}

/**
 * Normalize a stored Jira domain into an absolute origin `fetch()` accepts.
 * Users enter it as `acme.atlassian.net` (no scheme, sometimes a trailing
 * slash or a stray path); WHATWG fetch requires an absolute URL, so default to
 * https and strip everything after the host.
 */
export function normalizeJiraDomain(raw: string): string {
  let d = raw.trim();
  if (!/^https?:\/\//i.test(d)) d = `https://${d}`;
  try {
    return new URL(d).origin;
  } catch {
    return d.replace(/\/+$/, "");
  }
}

export async function listPlmProjects(
  userId: string,
  provider: PlmProvider,
  teamId: number | null,
): Promise<PlmProjectRef[]> {
  if (provider === "jira") {
    const c = await getConfigs(userId, ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"], teamId);
    if (!c.JIRA_DOMAIN || !c.JIRA_EMAIL || !c.JIRA_API_TOKEN) {
      throw new PlmError("Jira is not connected. Add your Jira credentials in Integrations.", "not_connected");
    }
    const domain = normalizeJiraDomain(c.JIRA_DOMAIN);
    const auth = `Basic ${Buffer.from(`${c.JIRA_EMAIL}:${c.JIRA_API_TOKEN}`).toString("base64")}`;
    const res = await fetch(`${domain}/rest/api/3/project/search?maxResults=100`, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new PlmError(`Jira responded ${res.status} while listing projects.`);
    const data = (await res.json()) as { values?: Array<{ key: string; name: string }> };
    return (data.values ?? []).map((v) => ({ key: v.key, name: v.name }));
  }

  // azure-devops
  const c = await getConfigs(userId, ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PAT"], teamId);
  if (!c.AZURE_DEVOPS_ORG || !c.AZURE_DEVOPS_PAT) {
    throw new PlmError("Azure DevOps is not connected. Add your Azure DevOps credentials in Integrations.", "not_connected");
  }
  const auth = `Basic ${Buffer.from(`:${c.AZURE_DEVOPS_PAT}`).toString("base64")}`;
  const res = await fetch(
    `https://dev.azure.com/${c.AZURE_DEVOPS_ORG}/_apis/projects?api-version=7.1`,
    { headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) throw new PlmError(`Azure DevOps responded ${res.status} while listing projects.`);
  const data = (await res.json()) as { value?: Array<{ id: string; name: string }> };
  // ADO projects have no short key; the project name is used as the key (spec §2.1).
  return (data.value ?? []).map((v) => ({ key: v.name, name: v.name }));
}

/**
 * Confirms the given project key/name is visible with the user's credentials.
 * Returns the canonical display name on success. Throws PlmError on a
 * not-connected / unreachable PLM.
 */
export async function validatePlmProject(
  userId: string,
  provider: PlmProvider,
  key: string,
  teamId: number | null,
): Promise<{ ok: boolean; name?: string }> {
  const projects = await listPlmProjects(userId, provider, teamId);
  const match = projects.find((p) => p.key === key || p.name === key);
  return match ? { ok: true, name: match.name } : { ok: false };
}
