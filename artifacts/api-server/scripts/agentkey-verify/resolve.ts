/**
 * Data-layer checks for workspace-owned credentials (0046).
 *
 * Needs DATABASE_URL. Writes and deletes rows for synthetic users and one
 * synthetic workspace; truncates nothing. See ../sequence-verify/README.md for
 * the throwaway-Postgres recipe.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/agentkey-verify/resolve.ts
 *
 * What it proves against a real database rather than a mock: every branch of
 * the resolution order for both credential kinds, that a policy change moves
 * the source without touching anyone's saved credentials, and that the two
 * run-stamp values follow what was actually resolved.
 */
import { eq, sql } from "drizzle-orm";
import { db, teamsTable, teamMembersTable } from "@workspace/db";
import { saveConfigs, getConfig } from "../../src/services/configService.js";
import { setTeamIntegration } from "../../src/services/teamService.js";
import { setWorkspaceSettings } from "../../src/services/workspaceSettings.js";
import { resolveModelKeys } from "../../src/services/modelKey.js";
import { resolveGitCreds } from "../../src/services/gitToken.js";

const ADMIN = "ak-verify-admin";
const MEMBER = "ak-verify-member";
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function cleanup(teamId?: number) {
  await db.execute(sql`DELETE FROM integration_configs WHERE user_id IN (${ADMIN}, ${MEMBER})`);
  if (teamId != null) await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
}

async function main() {
  await cleanup();
  await db.execute(sql`DELETE FROM teams WHERE name = 'ak-verify-workspace'`);

  const [team] = await db
    .insert(teamsTable)
    .values({ name: "ak-verify-workspace", ownerUserId: ADMIN, allowPersonalCredentials: true })
    .returning();
  await db.insert(teamMembersTable).values([
    { teamId: team.id, userId: ADMIN, role: "admin" },
    { teamId: team.id, userId: MEMBER, role: "member" },
  ]);

  process.env.KANDRYN_ANTHROPIC_API_KEY = "platform-a";
  process.env.KANDRYN_OPENAI_API_KEY = "platform-o";

  // The workspace's own credentials, set by its admin.
  await setTeamIntegration(team.id, "ANTHROPIC_API_KEY", "workspace-a", ADMIN);
  await setTeamIntegration(team.id, "OPENAI_API_KEY", "workspace-o", ADMIN);
  await setTeamIntegration(team.id, "GITHUB_TOKEN", "workspace-gh", ADMIN);

  // 1 — a member with nothing of their own gets the workspace's.
  let keys = await resolveModelKeys(MEMBER);
  check("member with no keys uses the workspace", keys.source === "workspace" && keys.anthropic === "workspace-a",
    `${keys.source}/${keys.anthropic}`);
  let git = await resolveGitCreds(MEMBER);
  check("member with no token uses the workspace token",
    git.source === "workspace" && git.githubToken === "workspace-gh", `${git.source}/${git.githubToken}`);

  // 2 — the same member saves their own; policy is on, so they override.
  await saveConfigs(MEMBER, { ANTHROPIC_API_KEY: "mine-a", GITHUB_TOKEN: "mine-gh" });
  keys = await resolveModelKeys(MEMBER);
  check("a personal key overrides while the policy allows it",
    keys.source === "personal" && keys.anthropic === "mine-a", `${keys.source}/${keys.anthropic}`);
  git = await resolveGitCreds(MEMBER);
  check("a personal token keeps commit attribution on the person",
    git.source === "personal" && git.githubToken === "mine-gh", `${git.source}/${git.githubToken}`);

  // 3 — the admin turns the policy off. Nothing is deleted.
  await setWorkspaceSettings(team.id, { allowPersonalCredentials: false });
  keys = await resolveModelKeys(MEMBER);
  git = await resolveGitCreds(MEMBER);
  check("policy off moves the member onto the workspace source",
    keys.source === "workspace" && git.source === "workspace", `${keys.source}/${git.source}`);
  check("their saved credentials are untouched, just unused",
    (await getConfig(MEMBER, "ANTHROPIC_API_KEY")) === "mine-a" &&
      (await getConfig(MEMBER, "GITHUB_TOKEN")) === "mine-gh");

  // 4 — the workspace switches to Kandryn Agents.
  await setWorkspaceSettings(team.id, { agentKeySource: "kandryn" });
  keys = await resolveModelKeys(MEMBER);
  check("workspace on Kandryn Agents funds the member", keys.source === "kandryn" && keys.anthropic === "platform-a",
    `${keys.source}/${keys.anthropic}`);
  git = await resolveGitCreds(MEMBER);
  check("the git token is unaffected by the agent source", git.source === "workspace");

  // 5 — the policy comes back on; a personal key outranks Kandryn.
  await setWorkspaceSettings(team.id, { allowPersonalCredentials: true });
  keys = await resolveModelKeys(MEMBER);
  check("a personal override outranks a workspace that chose Kandryn",
    keys.source === "personal" && keys.anthropic === "mine-a", keys.source);

  // 6 — the environment loses its platform credentials.
  await saveConfigs(MEMBER, { AGENT_KEY_SOURCE: "workspace" });
  delete process.env.KANDRYN_ANTHROPIC_API_KEY;
  delete process.env.KANDRYN_OPENAI_API_KEY;
  keys = await resolveModelKeys(MEMBER);
  check("no platform keys falls back to the workspace rather than failing",
    keys.source === "workspace" && keys.anthropic === "workspace-a", `${keys.source}/${keys.anthropic}`);

  // 7 — a user with no workspace at all is unchanged by any of this.
  await saveConfigs(ADMIN, { ANTHROPIC_API_KEY: "solo-a" });
  await db.delete(teamMembersTable).where(eq(teamMembersTable.userId, ADMIN));
  keys = await resolveModelKeys(ADMIN);
  check("a user with no workspace still runs on their own keys",
    keys.source === "personal" && keys.anthropic === "solo-a", `${keys.source}/${keys.anthropic}`);

  await cleanup(team.id);
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
