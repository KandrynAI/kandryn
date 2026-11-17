/**
 * The one place a model credential is chosen.
 *
 * Before this file, fourteen call sites each read ANTHROPIC_API_KEY or
 * OPENAI_API_KEY out of the per-user config store and handed it to a client
 * constructor. That was workable while there was exactly one answer. With
 * "Use Kandryn Agents" there are two, and a single call site that kept reading
 * the store directly would quietly spend the wrong party's money.
 *
 * Two rules hold here and nowhere else:
 *
 *   1. **Nothing outside this file reads the agent keys.** `modelKey.guard.test.ts`
 *      fails the build if that changes.
 *   2. **A key is always passed explicitly to a provider client.** Both SDKs
 *      default `apiKey` from `process.env.ANTHROPIC_API_KEY` /
 *      `process.env.OPENAI_API_KEY` when the argument is `undefined`, and a JS
 *      default parameter fires on `undefined`. So `new Anthropic({ apiKey:
 *      undefined })` silently bills whatever is in the environment. That is why
 *      the platform keys are deliberately named KANDRYN_* and never the two
 *      names the SDKs would pick up on their own: platform spend has to be a
 *      decision, not an accident, and it has to be distinguishable from one.
 *
 * The owner, not the actor. `resolveModelKey` takes the user who OWNS the work
 * (a run's `userId`), never whoever happens to be making the request. A team
 * admin approving someone else's parked plan must not move the cost onto their
 * own preference. 0040 and 0042 both hit this trap through `run.userId` and it
 * is the same shape here.
 */

import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db, runsTable, teamMembersTable } from "@workspace/db";
import { getConfig, getTeamConfig, type ConfigKey } from "./configService.js";
import { getWorkspaceSettings, type WorkspaceSettings } from "./workspaceSettings.js";
import { getTeamForUser } from "./teamService.js";
import {
  readPersonalPreference,
  type PersonalAgentPreference,
  type RunKeySource,
} from "../../../../shared/types/agentKey.js";

export type ModelProvider = "anthropic" | "openai";

/** The config key each provider's own-key lives under. */
const USER_KEY: Record<ModelProvider, ConfigKey> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * The platform key each provider's Kandryn-funded calls use.
 *
 * Deliberately NOT "ANTHROPIC_API_KEY"/"OPENAI_API_KEY": see rule 2 above.
 */
const PLATFORM_ENV: Record<ModelProvider, string> = {
  anthropic: "KANDRYN_ANTHROPIC_API_KEY",
  openai: "KANDRYN_OPENAI_API_KEY",
};

export interface ResolvedKey {
  /** The credential to hand a provider client, or undefined when there is none. */
  key: string | undefined;
  /** Which party's credential this is. Recorded on the run, never a key. */
  source: RunKeySource;
}

function platformKey(provider: ModelProvider): string | undefined {
  const value = process.env[PLATFORM_ENV[provider]];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Whether this deployment can fund runs at all.
 *
 * BOTH providers are required, because one choice covers both agents: a user
 * who picked Kandryn Agents with only Raptia funded would get a run that drops
 * to a single candidate with no explanation.
 */
export function platformAvailable(): boolean {
  return platformKey("anthropic") != null && platformKey("openai") != null;
}

/**
 * The one gating hook, in the shape `jiraExt/entitlement.ts` established.
 *
 * Everyone is entitled today. It exists so that when a plan check arrives it
 * lands in one file that two call sites already consult, rather than being
 * scattered across the routes at that point. No tier is invented here.
 */
export async function canUseKandrynAgents(_userId: string): Promise<boolean> {
  return true;
}

/** The person's own preference. The only thing about this they control. */
export async function getPersonalPreference(userId: string): Promise<PersonalAgentPreference> {
  return readPersonalPreference(await getConfig(userId, "AGENT_KEY_SOURCE"));
}

/**
 * Which party funds this work, decided with nothing to read.
 *
 * The order is the whole policy, and it reads in the order a person would
 * argue it: a personal override wins if the workspace permits one AND the
 * person asked for it AND they actually have credentials; otherwise the
 * workspace's own choice applies.
 *
 * `hasPersonalKeys` is part of the FIRST condition rather than a fallback
 * after it. A person who prefers their own keys but saved none should get the
 * workspace's credentials, not a failure: their preference describes what they
 * want when they can have it, not a refusal of everything else.
 */
export function chooseSource(input: {
  settings: WorkspaceSettings;
  preference: PersonalAgentPreference;
  hasPersonalKeys: boolean;
  platformOk: boolean;
  entitled: boolean;
}): RunKeySource {
  const { settings, preference, hasPersonalKeys, platformOk, entitled } = input;
  if (settings.allowPersonalCredentials && preference === "own" && hasPersonalKeys) return "personal";
  if (settings.agentKeySource === "kandryn" && platformOk && entitled) return "kandryn";
  // A workspace that chose Kandryn in an environment that cannot serve it falls
  // back to its own credentials rather than failing outright, the same way a
  // person who cannot have their override falls back to the workspace.
  return "workspace";
}

/**
 * Resolve one provider's credential for the user who owns the work.
 *
 * Reads the two scopes separately rather than through `getConfig(.., teamId)`,
 * which resolves team-FIRST: here a personal credential is an override the
 * workspace permits, not a fallback the workspace shadows.
 */
export async function resolveModelKey(
  ownerUserId: string,
  provider: ModelProvider,
): Promise<ResolvedKey> {
  const both = await resolveModelKeys(ownerUserId);
  return { key: provider === "anthropic" ? both.anthropic : both.openai, source: both.source };
}

/** Both providers in one pass. One decision covers both agents, by design. */
export async function resolveModelKeys(
  ownerUserId: string,
): Promise<{ anthropic: string | undefined; openai: string | undefined; source: RunKeySource }> {
  // Derived, not passed: see the note in gitToken.resolveGitCreds.
  const teamId = (await getTeamForUser(ownerUserId))?.team.id ?? null;
  const [settings, preference, entitled, personalA, personalO] = await Promise.all([
    getWorkspaceSettings(teamId),
    getPersonalPreference(ownerUserId),
    canUseKandrynAgents(ownerUserId),
    getConfig(ownerUserId, USER_KEY.anthropic),
    getConfig(ownerUserId, USER_KEY.openai),
  ]);

  const source = chooseSource({
    settings,
    preference,
    // Either agent is enough to count as "has credentials": a person with only
    // one saved is in exactly the position generation already tolerates, where
    // one agent answers and the other is recorded as failed.
    hasPersonalKeys: Boolean(personalA || personalO),
    platformOk: platformAvailable(),
    entitled,
  });

  if (source === "personal") {
    return { anthropic: personalA || undefined, openai: personalO || undefined, source };
  }
  if (source === "kandryn") {
    return { anthropic: platformKey("anthropic"), openai: platformKey("openai"), source };
  }
  if (teamId == null) {
    // No workspace to read credentials from. Everything this person has is
    // personal, so hand it back under its true name rather than claiming a
    // workspace source for keys no workspace owns.
    return { anthropic: personalA || undefined, openai: personalO || undefined, source: "personal" };
  }
  const [workspaceA, workspaceO] = await Promise.all([
    getTeamConfig(teamId, USER_KEY.anthropic),
    getTeamConfig(teamId, USER_KEY.openai),
  ]);
  return { anthropic: workspaceA || undefined, openai: workspaceO || undefined, source };
}

/**
 * The one message shown when no credential can be found, in either mode.
 *
 * Names the screen that exists ("Settings", not "Integrations") and the option
 * by its real label, and names no vendor.
 */
export const NO_MODEL_KEY_MESSAGE_ADMIN =
  "Set up agent credentials in Settings, Workspace, Agents.";
export const NO_MODEL_KEY_MESSAGE_MEMBER =
  "Your workspace admin has not set up agent credentials. Ask an admin to open Settings, Workspace, Agents.";

/**
 * The message a person sees when nothing could be resolved.
 *
 * Two versions, because telling a member to go and fix a workspace setting
 * they cannot reach is worse than telling them nothing: they go looking,
 * find the controls disabled, and file a bug. An admin gets the instruction;
 * everyone else gets told who to ask.
 */
export function noModelKeyMessage(isAdmin: boolean): string {
  return isAdmin ? NO_MODEL_KEY_MESSAGE_ADMIN : NO_MODEL_KEY_MESSAGE_MEMBER;
}

/**
 * Per-user daily ceiling on Kandryn-funded runs. Platform keys spend Kandryn's
 * money, so there is a brake here from the start even though it is off.
 *
 * `0` (the default, and anything unparseable) means no cap. Enforced at run
 * CREATION in routes/runs.ts, beside the existing pending-run cap, because that
 * is the only point with both the user and the intent to start work; the
 * resolver itself has no run context to count against.
 */
export function dailyRunCap(): number {
  const raw = Number(process.env.KANDRYN_AGENTS_DAILY_RUN_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * How many Kandryn-funded runs this user has created since midnight UTC.
 * Returns null when no cap is configured, so the caller can skip the query.
 */
export async function kandrynRunsToday(
  userId: string,
  teamId: number | null | undefined,
): Promise<number | null> {
  if (dailyRunCap() === 0) return null;
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  // Per WORKSPACE, because the workspace is what chose to spend Kandryn's
  // money: a per-user cap on a shared decision would let a ten-person team
  // spend ten times what a one-person team can. With no workspace the user is
  // the only possible unit, so it falls back to them.
  const scope = teamId == null
    ? eq(runsTable.userId, userId)
    : inArray(
        runsTable.userId,
        db.select({ u: teamMembersTable.userId }).from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId)),
      );
  const [row] = await db
    .select({ n: count() })
    .from(runsTable)
    .where(and(scope, eq(runsTable.agentKeySource, "kandryn"), gte(runsTable.createdAt, midnight)));
  return row?.n ?? 0;
}
