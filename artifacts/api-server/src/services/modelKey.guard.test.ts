import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One place decides whose credentials a model call spends.
 *
 * Before `modelKey.ts` there were fourteen independent reads of
 * ANTHROPIC_API_KEY and OPENAI_API_KEY. That was fine while there was one
 * possible answer. With "Use Kandryn Agents" a single straggler bills the wrong
 * party, silently and correctly-looking, which is exactly the class of bug no
 * review catches. This guard fails the build when one comes back.
 *
 * It also enforces the subtler half. Both provider SDKs declare
 * `apiKey = readEnv('ANTHROPIC_API_KEY')` / `readEnv('OPENAI_API_KEY')` as a
 * DEFAULT PARAMETER, and a JS default fires on `undefined`. So
 * `new Anthropic({ apiKey: someUndefinedVariable })` quietly uses whatever is
 * in the server environment. A construction with no apiKey argument at all does
 * the same. Either would make platform spend an accident rather than a choice,
 * and would make it indistinguishable from a user's own key in every record we
 * keep.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The credential names, and why each file outside the resolvers may still say them. */
const KEY_NAME_ALLOWED: Record<string, string> = {
  "services/modelKey.ts": "The model resolver. The one place that maps a provider to a config key.",
  "services/gitToken.ts": "The git resolver. Same rule, same reason.",
  "services/configService.ts": "CONFIG_KEYS declares the names; it stores values and knows nothing about choosing one.",
  "lib/env.ts": "Startup env validation lists the names for logging. It reads nothing at call time.",
  "routes/teams.ts": "TEAM_CONFIG_KEYS declares which credentials a workspace may own (0046). A declaration of what MAY be stored, never a choice of which to use.",
  "routes/config.ts":
    "Test connection must test the key the user typed or saved, never the platform's. " +
    "Routing it through the resolver would report the platform's health as the user's, " +
    "and would leak platform availability as a connection result. The UI disables the " +
    "button in Kandryn mode instead.",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") sourceFiles(full, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The comments above name the forbidden patterns; they must not trip the guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC).map((full) => ({
  rel: relative(SRC, full).split(sep).join("/"),
  code: stripComments(readFileSync(full, "utf8")),
}));

test("guard: the api-server sources were found", () => {
  // Without this every assertion below passes on an empty list.
  assert.ok(files.length > 40, `expected the api-server sources, found ${files.length}`);
  assert.ok(
    files.some((f) => f.rel === "services/modelKey.ts"),
    "modelKey.ts is the file this guard exists for and it was not scanned",
  );
});

test("the agent key names appear only where they are allowed", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    if (rel in KEY_NAME_ALLOWED) continue;
    code.split("\n").forEach((line, i) => {
      if (/\bANTHROPIC_API_KEY\b|\bOPENAI_API_KEY\b/.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "Resolve the key through services/modelKey.ts instead of reading the config store here.\n" +
      offenders.join("\n"),
  );
});

test("the platform key names appear only in the resolver", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    if (rel === "services/modelKey.ts") continue;
    code.split("\n").forEach((line, i) => {
      if (/KANDRYN_ANTHROPIC_API_KEY|KANDRYN_OPENAI_API_KEY/.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `Platform keys are read in one place only:\n${offenders.join("\n")}`);
});

test("every provider client is constructed with an explicit apiKey", () => {
  // A bare `new Anthropic()` or `new OpenAI()` takes the key from the server
  // environment, which is how a platform key gets spent without anyone choosing
  // it. The argument must be there; what it resolves to is the previous test's
  // business.
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    code.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/new (Anthropic|OpenAI)\s*\(([^)]*)/g)) {
        // `{ apiKey: x }` and the shorthand `{ apiKey }` both count.
        if (!/\bapiKey\b/.test(m[2])) offenders.push(`${rel}:${i + 1}  new ${m[1]}(${m[2].trim()})`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "A provider client with no apiKey argument reads it from the environment:\n" + offenders.join("\n"),
  );
});

/**
 * The same rule for git credentials.
 *
 * Twenty-one reads became one helper in 0046. The failure this prevents is
 * quieter than the model-key one: a straggler reading GITHUB_TOKEN directly
 * still works for anyone with a personal token, and only breaks for the
 * members a workspace credential was introduced to serve. It would pass every
 * manual test run by the person who wrote it.
 */
const GIT_NAME_ALLOWED: Record<string, string> = {
  "services/gitToken.ts": "The resolver itself.",
  "services/configService.ts": "CONFIG_KEYS declares the names; it stores values and chooses nothing.",
  "lib/env.ts": "Startup env validation lists the names for logging.",
  "routes/teams.ts": "TEAM_CONFIG_KEYS declares which credentials a workspace may own.",
  "routes/config.ts":
    "Two cases. github-sync upserts the PERSONAL token from Clerk, which is a write, not a " +
    "resolution. Test connection must test the credential the user typed or saved, never the " +
    "workspace's, or it would report someone else's health as theirs.",
};

test("the git credential names appear only where they are allowed", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    if (rel in GIT_NAME_ALLOWED) continue;
    code.split("\n").forEach((line, i) => {
      if (/\bGITHUB_TOKEN\b|\bAZURE_REPOS_TOKEN\b|\bAZURE_REPOS_ORG\b/.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "Resolve git credentials through services/gitToken.ts instead of reading the config store here.\n" +
      offenders.join("\n"),
  );
});
