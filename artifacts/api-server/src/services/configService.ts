/**
 * Manages per-user integration credentials stored in the `integration_configs` DB table.
 * All operations are scoped by userId (Clerk user ID) for multi-tenant isolation.
 */
import { and, eq } from "drizzle-orm";
import { db, integrationConfigsTable, teamIntegrationsTable } from "@workspace/db";
import { encryptSecret, decryptSecret, isEncrypted, isEncryptionEnabled } from "./configCrypto.js";

export const CONFIG_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "GITHUB_COPILOT_TOKEN",
  "GITHUB_TOKEN",
  "AZURE_REPOS_ORG",
  "AZURE_REPOS_TOKEN",
  "AZURE_DEVOPS_ORG",
  "AZURE_DEVOPS_PROJECT",
  "AZURE_DEVOPS_PAT",
  "JIRA_DOMAIN",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "CONFLUENCE_DOMAIN",
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_SPACE_KEY",
  "NOTION_API_TOKEN",
  "NOTION_PARENT_PAGE",
  // Team preference (not a credential): how Aegis files findings in Jira —
  // "bug" | "subtask" | "smart". Stored team-level; read team-first.
  "AEGIS_JIRA_ISSUE_TYPE",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** Get all config keys with masked values for a specific user */
export async function getAllConfigs(
  userId: string,
): Promise<Record<string, { set: boolean; masked: string }>> {
  const rows = await db
    .select()
    .from(integrationConfigsTable)
    .where(eq(integrationConfigsTable.userId, userId));

  const dbMap = new Map(rows.map((r) => [r.key, decryptSecret(r.value)]));

  const result: Record<string, { set: boolean; masked: string }> = {};
  for (const key of CONFIG_KEYS) {
    const value = dbMap.get(key) ?? "";
    result[key] = {
      set: value.length > 0,
      masked: value.length > 0 ? maskSecret(value) : "",
    };
  }
  return result;
}

/**
 * Get a single config value for a user (returns empty string if not set). When
 * `teamId` is provided, a team-level credential (team_integrations) wins over the
 * personal one — the multi-tenancy credential-resolution rule (0017).
 */
export async function getConfig(
  userId: string,
  key: ConfigKey,
  teamId?: number | null,
): Promise<string> {
  if (teamId != null) {
    const [t] = await db
      .select()
      .from(teamIntegrationsTable)
      .where(and(eq(teamIntegrationsTable.teamId, teamId), eq(teamIntegrationsTable.key, key)));
    if (t?.value) return decryptSecret(t.value);
  }
  const [row] = await db
    .select()
    .from(integrationConfigsTable)
    .where(
      and(
        eq(integrationConfigsTable.userId, userId),
        eq(integrationConfigsTable.key, key),
      ),
    );
  return row?.value ? decryptSecret(row.value) : "";
}

/**
 * Get multiple config values for a user as a key→value map. When `teamId` is
 * provided, each key resolves team-first then personal (0017). Omitting `teamId`
 * preserves the original personal-only behaviour.
 */
export async function getConfigs(
  userId: string,
  keys: ConfigKey[],
  teamId?: number | null,
): Promise<Partial<Record<ConfigKey, string>>> {
  const rows = await db
    .select()
    .from(integrationConfigsTable)
    .where(eq(integrationConfigsTable.userId, userId));
  const personal = new Map(rows.map((r) => [r.key as ConfigKey, decryptSecret(r.value)]));

  const team = new Map<ConfigKey, string>();
  if (teamId != null) {
    const trows = await db
      .select()
      .from(teamIntegrationsTable)
      .where(eq(teamIntegrationsTable.teamId, teamId));
    for (const r of trows) team.set(r.key as ConfigKey, decryptSecret(r.value));
  }

  const result: Partial<Record<ConfigKey, string>> = {};
  for (const key of keys) {
    const val = team.get(key) ?? personal.get(key);
    if (val) result[key] = val;
  }
  return result;
}

/** Save a batch of key→value pairs to DB for a specific user */
export async function saveConfigs(
  userId: string,
  entries: Partial<Record<ConfigKey, string>>,
): Promise<void> {
  for (const [key, value] of Object.entries(entries) as [ConfigKey, string][]) {
    if (!value || value.trim() === "") continue;
    const encrypted = encryptSecret(value.trim());
    await db
      .insert(integrationConfigsTable)
      .values({ userId, key, value: encrypted })
      .onConflictDoUpdate({
        target: [integrationConfigsTable.userId, integrationConfigsTable.key],
        set: { value: encrypted },
      });
  }
}

/**
 * One-time backfill: encrypt any plaintext rows in `integration_configs` and
 * `team_integrations` in place. Idempotent — already-enveloped rows are skipped,
 * so it can be re-run safely. When no key is configured it no-ops (nothing to
 * encrypt to), reporting `skipped: true`. Invoked by the CRON_SECRET-guarded
 * `/api/internal/encrypt-configs` endpoint after the key is set in production.
 */
export async function backfillEncryption(): Promise<{
  configs: number;
  teamIntegrations: number;
  skipped: boolean;
}> {
  if (!isEncryptionEnabled()) return { configs: 0, teamIntegrations: 0, skipped: true };

  let configs = 0;
  const rows = await db.select().from(integrationConfigsTable);
  for (const r of rows) {
    if (isEncrypted(r.value)) continue;
    await db
      .update(integrationConfigsTable)
      .set({ value: encryptSecret(r.value) })
      .where(
        and(
          eq(integrationConfigsTable.userId, r.userId),
          eq(integrationConfigsTable.key, r.key),
        ),
      );
    configs++;
  }

  let teamIntegrations = 0;
  const trows = await db.select().from(teamIntegrationsTable);
  for (const r of trows) {
    if (isEncrypted(r.value)) continue;
    await db
      .update(teamIntegrationsTable)
      .set({ value: encryptSecret(r.value) })
      .where(
        and(
          eq(teamIntegrationsTable.teamId, r.teamId),
          eq(teamIntegrationsTable.key, r.key),
        ),
      );
    teamIntegrations++;
  }

  return { configs, teamIntegrations, skipped: false };
}

/** Delete a config key for a specific user */
export async function deleteConfig(userId: string, key: ConfigKey): Promise<void> {
  await db
    .delete(integrationConfigsTable)
    .where(
      and(
        eq(integrationConfigsTable.userId, userId),
        eq(integrationConfigsTable.key, key),
      ),
    );
}

function maskSecret(value: string): string {
  if (value.length <= 4) return "••••••••";
  return "••••••••" + value.slice(-4);
}
