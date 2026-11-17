/**
 * 0046 backfill: give each workspace the agent source its owner had chosen.
 *
 * A script rather than SQL inside docs/db/0046_workspace_settings.sql, and the
 * reason is not style. The per-user value lives in `integration_configs.value`,
 * which is AES-256-GCM enciphered at rest whenever CONFIG_ENCRYPTION_KEY is
 * set. SQL would read envelopes. Only application code holds the key.
 *
 *   DATABASE_URL=... CONFIG_ENCRYPTION_KEY=... npx tsx scripts/agentkey-verify/backfill-0046.ts
 *   ... --apply     to write; without it the script only reports
 *
 * Idempotent: a workspace whose agent_key_source is already set is skipped, so
 * a second run cannot overwrite a choice an admin has since made. Run it once
 * after applying 0046, before anyone opens Settings.
 *
 * Nothing here deletes or rewrites a credential. The owner's personal keys
 * stay exactly where they are; only the workspace's own column is written.
 */
import { eq, isNull } from "drizzle-orm";
import { db, teamsTable } from "@workspace/db";
import { getConfig } from "../../src/services/configService.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await db
    .select({ id: teamsTable.id, name: teamsTable.name, owner: teamsTable.ownerUserId })
    .from(teamsTable)
    .where(isNull(teamsTable.agentKeySource));

  let kandryn = 0;
  let workspaceKeys = 0;

  for (const row of rows) {
    // The owner's retired per-user value. "kandryn" was a real choice to spend
    // Kandryn's money and carries forward; anything else means they were on
    // their own keys, which at workspace level is "workspace_keys".
    const previous = await getConfig(row.owner, "AGENT_KEY_SOURCE");
    const next = previous === "kandryn" ? "kandryn" : "workspace_keys";
    if (next === "kandryn") kandryn++;
    else workspaceKeys++;
    if (APPLY) {
      await db.update(teamsTable).set({ agentKeySource: next }).where(eq(teamsTable.id, row.id));
    }
  }

  console.log(`${APPLY ? "Set" : "Would set"} agent_key_source on ${rows.length} workspace(s):`);
  console.log(`  kandryn:        ${kandryn}`);
  console.log(`  workspace_keys: ${workspaceKeys}`);
  if (!APPLY) console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

void main();
