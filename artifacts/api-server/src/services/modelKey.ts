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

import { and, count, eq, gte } from "drizzle-orm";
import { db, runsTable } from "@workspace/db";
import { getConfig, type ConfigKey } from "./configService.js";
import {
  DEFAULT_AGENT_KEY_SOURCE,
  isAgentKeySource,
  type AgentKeySource,
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
  source: AgentKeySource;
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

/** The user's stored preference, defaulting to today's behaviour. */
export async function getKeySource(userId: string): Promise<AgentKeySource> {
  const stored = await getConfig(userId, "AGENT_KEY_SOURCE");
  return isAgentKeySource(stored) ? stored : DEFAULT_AGENT_KEY_SOURCE;
}

/**
 * The effective source for a user: their preference, downgraded to `own` when
 * the platform cannot actually serve it.
 *
 * Downgrading rather than failing is deliberate. A deployment that loses its
 * platform keys should fall back to the credentials the user still has saved
 * (B2 keeps them untouched), not refuse every run until someone notices a
 * missing environment variable.
 */
export async function effectiveSource(userId: string): Promise<AgentKeySource> {
  const [preferred, entitled] = await Promise.all([getKeySource(userId), canUseKandrynAgents(userId)]);
  return chooseSource(preferred, platformAvailable(), entitled);
}

/**
 * The decision itself, with nothing to read. Split out for the reason
 * confidenceScore.ts is split from confidence.ts: the rule is the part worth
 * proving, and proving it should not need a database.
 */
export function chooseSource(
  preferred: AgentKeySource,
  platformOk: boolean,
  entitled: boolean,
): AgentKeySource {
  if (preferred !== "kandryn") return "own";
  return platformOk && entitled ? "kandryn" : "own";
}

/**
 * Resolve one provider's credential for the user who owns the work.
 *
 * `teamId` keeps the team-first resolution `getConfigs` already does for the
 * own-key path (0017). It has no effect in `kandryn` mode: a team cannot share
 * the platform's credentials, it either has them or it does not.
 */
export async function resolveModelKey(
  ownerUserId: string,
  teamId: number | null | undefined,
  provider: ModelProvider,
): Promise<ResolvedKey> {
  const source = await effectiveSource(ownerUserId);
  if (source === "kandryn") return { key: platformKey(provider), source };
  const own = await getConfig(ownerUserId, USER_KEY[provider], teamId ?? null);
  return { key: own || undefined, source: "own" };
}

/** Both providers in one read, for the paths that run Raptia and Fovea together. */
export async function resolveModelKeys(
  ownerUserId: string,
  teamId: number | null | undefined,
): Promise<{ anthropic: string | undefined; openai: string | undefined; source: AgentKeySource }> {
  const source = await effectiveSource(ownerUserId);
  if (source === "kandryn") {
    return { anthropic: platformKey("anthropic"), openai: platformKey("openai"), source };
  }
  const [anthropic, openai] = await Promise.all([
    getConfig(ownerUserId, "ANTHROPIC_API_KEY", teamId ?? null),
    getConfig(ownerUserId, "OPENAI_API_KEY", teamId ?? null),
  ]);
  return { anthropic: anthropic || undefined, openai: openai || undefined, source: "own" };
}

/**
 * The one message shown when no credential can be found, in either mode.
 *
 * Names the screen that exists ("Settings", not "Integrations") and the option
 * by its real label, and names no vendor.
 */
export const NO_MODEL_KEY_MESSAGE =
  "Add your Raptia and Fovea credentials in Settings, or choose Use Kandryn Agents.";

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
export async function kandrynRunsToday(userId: string): Promise<number | null> {
  if (dailyRunCap() === 0) return null;
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: count() })
    .from(runsTable)
    .where(
      and(
        eq(runsTable.userId, userId),
        eq(runsTable.agentKeySource, "kandryn"),
        gte(runsTable.createdAt, midnight),
      ),
    );
  return row?.n ?? 0;
}
