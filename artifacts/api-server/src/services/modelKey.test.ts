import { test } from "node:test";
import assert from "node:assert/strict";
// node-postgres connects lazily, so importing the module is safe without a real
// database as long as nothing queries. The pure parts below never do.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { chooseSource, platformAvailable, dailyRunCap, noModelKeyMessage } = await import("./modelKey.js");

const ws = (over: Record<string, unknown> = {}) =>
  ({ agentKeySource: "workspace_keys", allowPersonalCredentials: true, ...over }) as
    Parameters<typeof chooseSource>[0]["settings"];
const choose = (over: Record<string, unknown> = {}) =>
  chooseSource({
    settings: ws(),
    preference: "own",
    hasPersonalKeys: true,
    platformOk: true,
    entitled: true,
    ...over,
  });

test("a personal override needs all three of policy, preference and keys", () => {
  assert.equal(choose(), "personal");
  assert.equal(choose({ settings: ws({ allowPersonalCredentials: false }) }), "workspace");
  assert.equal(choose({ preference: "workspace" }), "workspace");
  assert.equal(choose({ hasPersonalKeys: false }), "workspace");
});

test("a person who prefers their own keys but saved none gets the workspace, not a failure", () => {
  // Their preference says what they want when they can have it. Treating it as
  // a refusal of everything else would strand them with no credential at all.
  assert.equal(choose({ hasPersonalKeys: false, settings: ws({ agentKeySource: "kandryn" }) }), "kandryn");
});

test("the workspace choice applies once no override wins", () => {
  const noOverride = { preference: "workspace" as const };
  assert.equal(choose({ ...noOverride, settings: ws({ agentKeySource: "kandryn" }) }), "kandryn");
  assert.equal(choose({ ...noOverride, settings: ws({ agentKeySource: "workspace_keys" }) }), "workspace");
});

test("kandryn needs both the platform and the entitlement, and falls back rather than failing", () => {
  const k = { preference: "workspace" as const, settings: ws({ agentKeySource: "kandryn" }) };
  assert.equal(choose({ ...k, platformOk: false }), "workspace");
  assert.equal(choose({ ...k, entitled: false }), "workspace");
});

test("the personal override outranks a workspace that chose Kandryn", () => {
  // The policy toggle is what an admin uses to stop this, not the source.
  assert.equal(choose({ settings: ws({ agentKeySource: "kandryn" }) }), "personal");
});

test("each missing-key message names a screen its reader can actually reach", () => {
  const admin = noModelKeyMessage(true);
  const member = noModelKeyMessage(false);
  // An admin gets the instruction; a member gets told who to ask, because
  // sending them to controls they cannot use is worse than saying nothing.
  assert.match(admin, /Settings, Workspace, Agents/);
  assert.match(member, /Ask an admin/);
  for (const m of [admin, member]) {
    assert.doesNotMatch(m, /Integrations/);
    assert.doesNotMatch(m, /anthropic|openai|claude|gpt/i);
    assert.ok(!m.includes("\u2014"), m);
  }
});
