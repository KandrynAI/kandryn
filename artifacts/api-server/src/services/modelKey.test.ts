import { test } from "node:test";
import assert from "node:assert/strict";
// node-postgres connects lazily, so importing the module is safe without a real
// database as long as nothing queries. The pure parts below never do.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { chooseSource, platformAvailable, dailyRunCap, NO_MODEL_KEY_MESSAGE } = await import("./modelKey.js");

test("own stays own, whatever the platform can do", () => {
  assert.equal(chooseSource("own", true, true), "own");
  assert.equal(chooseSource("own", false, false), "own");
});

test("kandryn needs both the platform and the entitlement", () => {
  assert.equal(chooseSource("kandryn", true, true), "kandryn");
  assert.equal(chooseSource("kandryn", false, true), "own");
  assert.equal(chooseSource("kandryn", true, false), "own");
  assert.equal(chooseSource("kandryn", false, false), "own");
});

test("a deployment that loses its platform keys falls back rather than failing", () => {
  // B2 keeps the user's own keys when they switch away, so there is something
  // to fall back TO. Refusing every run instead would turn one missing
  // environment variable into an outage.
  assert.equal(chooseSource("kandryn", false, true), "own");
});

test("platform availability needs BOTH providers", () => {
  const before = { a: process.env.KANDRYN_ANTHROPIC_API_KEY, o: process.env.KANDRYN_OPENAI_API_KEY };
  try {
    delete process.env.KANDRYN_ANTHROPIC_API_KEY;
    delete process.env.KANDRYN_OPENAI_API_KEY;
    assert.equal(platformAvailable(), false, "neither set");

    process.env.KANDRYN_ANTHROPIC_API_KEY = "x";
    assert.equal(platformAvailable(), false, "one agent funded is not funded");

    process.env.KANDRYN_OPENAI_API_KEY = "y";
    assert.equal(platformAvailable(), true);

    // Whitespace is not a key.
    process.env.KANDRYN_OPENAI_API_KEY = "   ";
    assert.equal(platformAvailable(), false);
  } finally {
    if (before.a == null) delete process.env.KANDRYN_ANTHROPIC_API_KEY;
    else process.env.KANDRYN_ANTHROPIC_API_KEY = before.a;
    if (before.o == null) delete process.env.KANDRYN_OPENAI_API_KEY;
    else process.env.KANDRYN_OPENAI_API_KEY = before.o;
  }
});

test("the daily cap is off unless set to a positive whole number", () => {
  const before = process.env.KANDRYN_AGENTS_DAILY_RUN_CAP;
  try {
    delete process.env.KANDRYN_AGENTS_DAILY_RUN_CAP;
    assert.equal(dailyRunCap(), 0, "unset is off");
    for (const bad of ["", "0", "-5", "abc", "NaN"]) {
      process.env.KANDRYN_AGENTS_DAILY_RUN_CAP = bad;
      assert.equal(dailyRunCap(), 0, `${JSON.stringify(bad)} is off`);
    }
    process.env.KANDRYN_AGENTS_DAILY_RUN_CAP = "25";
    assert.equal(dailyRunCap(), 25);
    process.env.KANDRYN_AGENTS_DAILY_RUN_CAP = "7.9";
    assert.equal(dailyRunCap(), 7, "floored, never rounded up");
  } finally {
    if (before == null) delete process.env.KANDRYN_AGENTS_DAILY_RUN_CAP;
    else process.env.KANDRYN_AGENTS_DAILY_RUN_CAP = before;
  }
});

test("the missing-key message names a screen that exists and no vendor", () => {
  assert.match(NO_MODEL_KEY_MESSAGE, /Settings/);
  assert.match(NO_MODEL_KEY_MESSAGE, /Use Kandryn Agents/);
  assert.doesNotMatch(NO_MODEL_KEY_MESSAGE, /Integrations/);
  assert.doesNotMatch(NO_MODEL_KEY_MESSAGE, /anthropic|openai|claude|gpt/i);
  assert.doesNotMatch(NO_MODEL_KEY_MESSAGE, /—/);
});
