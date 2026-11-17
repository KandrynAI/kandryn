import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_SOURCE_HELP,
  AGENT_SOURCE_LABEL,
  OWN_KEYS_KEPT,
  canChange,
  canSelect,
  kandrynBlockedReason,
} from "./agentSource.ts";
import type { AgentKeySourceState } from "../services/api.ts";

const state = (over: Partial<AgentKeySourceState> = {}): AgentKeySourceState => ({
  source: "own",
  platformAvailable: true,
  entitled: true,
  ...over,
});

test("nothing is blocked when the platform can serve it", () => {
  assert.equal(kandrynBlockedReason(state()), null);
  assert.equal(canSelect("kandryn", state(), false), true);
});

test("a deployment with no platform credentials blames the environment, not the account", () => {
  // Getting this the wrong way round sends a user to support over a missing
  // environment variable.
  const r = kandrynBlockedReason(state({ platformAvailable: false, entitled: false }));
  assert.match(r ?? "", /environment/);
  assert.doesNotMatch(r ?? "", /account/);
});

test("an un-entitled account is told so, once the platform itself is fine", () => {
  assert.match(kandrynBlockedReason(state({ entitled: false })) ?? "", /account/);
});

test("a blocked option cannot be selected, and own always can", () => {
  const blocked = state({ platformAvailable: false });
  assert.equal(canSelect("kandryn", blocked, false), false);
  assert.equal(canSelect("own", blocked, false), true);
});

test("a user stranded in kandryn mode can still switch back", () => {
  // The server downgrades them to own-key behaviour anyway; the screen must not
  // trap them in a selection they cannot change.
  const stranded = state({ source: "kandryn", platformAvailable: false });
  assert.equal(canChange(stranded, false), true);
  assert.equal(canSelect("own", stranded, false), true);
});

test("nothing is selectable while loading or saving", () => {
  assert.equal(canChange(null, false), false);
  assert.equal(canSelect("own", null, false), false);
  assert.equal(canSelect("own", state(), true), false);
  assert.equal(canSelect("kandryn", state(), true), false);
});

test("the copy says Kandryn Agents, names no vendor, and has no em dash", () => {
  const all = [...Object.values(AGENT_SOURCE_LABEL), ...Object.values(AGENT_SOURCE_HELP), OWN_KEYS_KEPT,
    kandrynBlockedReason(state({ platformAvailable: false })) ?? "",
    kandrynBlockedReason(state({ entitled: false })) ?? ""];
  assert.equal(AGENT_SOURCE_LABEL.kandryn, "Use Kandryn Agents");
  for (const s of all) {
    assert.doesNotMatch(s, /anthropic|openai|claude|gpt|sonnet|opus/i, s);
    assert.ok(!s.includes("—"), s);
  }
});
