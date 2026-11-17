/**
 * Data-layer checks for "Use Kandryn Agents".
 *
 * Needs DATABASE_URL and TRUNCATES the tables it uses. Not part of `pnpm test`.
 * See ../sequence-verify/README.md for the throwaway-Postgres recipe.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/agentkey-verify/resolve.ts
 *
 * What it proves, against a real database rather than a mock:
 *   1. With no stored preference a user resolves to their own keys.
 *   2. Choosing kandryn resolves to the PLATFORM keys, not the user's.
 *   3. The user's own keys survive the switch and come back on switching away.
 *   4. With the platform keys absent, kandryn downgrades to own rather than
 *      resolving to undefined.
 *   5. resolveModelKeys reports the source it actually used.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { saveConfigs, getConfig } from "../../src/services/configService.js";
import { resolveModelKey, resolveModelKeys, getKeySource } from "../../src/services/modelKey.js";

const USER = "agentkey-verify-user";
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  await db.execute(sql`DELETE FROM integration_configs WHERE user_id = ${USER}`);

  process.env.KANDRYN_ANTHROPIC_API_KEY = "platform-anthropic";
  process.env.KANDRYN_OPENAI_API_KEY = "platform-openai";

  await saveConfigs(USER, { ANTHROPIC_API_KEY: "user-anthropic", OPENAI_API_KEY: "user-openai" });

  // 1 — the default.
  check("no preference means own", (await getKeySource(USER)) === "own");
  let a = await resolveModelKey(USER, null, "anthropic");
  check("own resolves the user's key", a.key === "user-anthropic" && a.source === "own", `${a.source}/${a.key}`);

  // 2 — the switch.
  await saveConfigs(USER, { AGENT_KEY_SOURCE: "kandryn" });
  a = await resolveModelKey(USER, null, "anthropic");
  const o = await resolveModelKey(USER, null, "openai");
  check("kandryn resolves the platform key for both providers",
    a.key === "platform-anthropic" && o.key === "platform-openai" && a.source === "kandryn",
    `${a.key} / ${o.key}`);

  // 3 — the user's keys are untouched by the switch (B2).
  check("the user's own keys still exist while kandryn is selected",
    (await getConfig(USER, "ANTHROPIC_API_KEY")) === "user-anthropic");
  await saveConfigs(USER, { AGENT_KEY_SOURCE: "own" });
  a = await resolveModelKey(USER, null, "anthropic");
  check("switching back uses the untouched key", a.key === "user-anthropic" && a.source === "own");

  // 4 — the environment loses its platform keys.
  await saveConfigs(USER, { AGENT_KEY_SOURCE: "kandryn" });
  delete process.env.KANDRYN_ANTHROPIC_API_KEY;
  delete process.env.KANDRYN_OPENAI_API_KEY;
  a = await resolveModelKey(USER, null, "anthropic");
  check("no platform keys downgrades to own rather than returning nothing",
    a.key === "user-anthropic" && a.source === "own", `${a.source}/${a.key}`);

  // 5 — both at once, and the source it reports.
  process.env.KANDRYN_ANTHROPIC_API_KEY = "platform-anthropic";
  process.env.KANDRYN_OPENAI_API_KEY = "platform-openai";
  const both = await resolveModelKeys(USER, null);
  check("resolveModelKeys reports the source it used",
    both.source === "kandryn" && both.anthropic === "platform-anthropic" && both.openai === "platform-openai",
    both.source);

  await db.execute(sql`DELETE FROM integration_configs WHERE user_id = ${USER}`);
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
