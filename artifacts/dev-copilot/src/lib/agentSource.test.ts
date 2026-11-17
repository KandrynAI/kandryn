import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANAGED_BY_WORKSPACE,
  POLICY_OFF_NOTE,
  SOURCE_TAKES_EFFECT_NEXT_RUN,
  WORKSPACE_SOURCE_HELP,
  WORKSPACE_SOURCE_LABEL,
  canSelectWorkspaceSource,
  kandrynBlockedReason,
  personalCredentialsHiddenNote,
  showsPersonalCredentials,
} from "./agentSource.ts";
import type { AgentPreferenceState, WorkspaceSettingsState } from "../services/api.ts";

const ws = (over: Partial<WorkspaceSettingsState> = {}): WorkspaceSettingsState => ({
  agentKeySource: "workspace_keys",
  allowPersonalCredentials: true,
  platformAvailable: true,
  canEdit: true,
  ...over,
});

const pref = (over: Partial<AgentPreferenceState> = {}): AgentPreferenceState => ({
  preference: "own",
  allowPersonalCredentials: true,
  workspaceSource: "workspace_keys",
  platformAvailable: true,
  hasWorkspace: true,
  ...over,
});

test("an admin in a funded environment can select either source", () => {
  assert.equal(canSelectWorkspaceSource("kandryn", ws(), false), true);
  assert.equal(canSelectWorkspaceSource("workspace_keys", ws(), false), true);
  assert.equal(kandrynBlockedReason(ws()), null);
});

test("a member cannot select anything, whatever the environment offers", () => {
  // The server rejects a forged write regardless; this is only what renders.
  const member = ws({ canEdit: false });
  assert.equal(canSelectWorkspaceSource("kandryn", member, false), false);
  assert.equal(canSelectWorkspaceSource("workspace_keys", member, false), false);
});

test("an unfunded environment blames the environment, and only blocks Kandryn", () => {
  const unfunded = ws({ platformAvailable: false });
  assert.match(kandrynBlockedReason(unfunded) ?? "", /environment/);
  assert.equal(canSelectWorkspaceSource("kandryn", unfunded, false), false);
  // The workspace must still be able to choose its own credentials, or an
  // admin is stranded with no selectable option at all.
  assert.equal(canSelectWorkspaceSource("workspace_keys", unfunded, false), true);
});

test("nothing is selectable while loading or saving", () => {
  assert.equal(canSelectWorkspaceSource("kandryn", null, false), false);
  assert.equal(canSelectWorkspaceSource("workspace_keys", ws(), true), false);
});

test("My account shows personal credentials only when the workspace allows them", () => {
  assert.equal(showsPersonalCredentials(pref()), true);
  assert.equal(showsPersonalCredentials(pref({ allowPersonalCredentials: false })), false);
  assert.equal(personalCredentialsHiddenNote(pref()), null);
  assert.equal(personalCredentialsHiddenNote(pref({ allowPersonalCredentials: false })), MANAGED_BY_WORKSPACE);
});

test("a user with no workspace always sees their own credentials", () => {
  // There is nobody to forbid it, and personal credentials are all that exist.
  // Reading allowPersonalCredentials here would hide the only section they have.
  const solo = pref({ hasWorkspace: false, allowPersonalCredentials: false });
  assert.equal(showsPersonalCredentials(solo), true);
  assert.equal(personalCredentialsHiddenNote(solo), null);
});

test("nothing is known before the state loads", () => {
  assert.equal(showsPersonalCredentials(null), false);
  assert.equal(kandrynBlockedReason(null), null);
});

test("the copy says Kandryn Agents, names no vendor, and has no em dash", () => {
  const all = [
    ...Object.values(WORKSPACE_SOURCE_LABEL),
    ...Object.values(WORKSPACE_SOURCE_HELP),
    MANAGED_BY_WORKSPACE,
    POLICY_OFF_NOTE,
    SOURCE_TAKES_EFFECT_NEXT_RUN,
    kandrynBlockedReason(ws({ platformAvailable: false })) ?? "",
  ];
  assert.equal(WORKSPACE_SOURCE_LABEL.kandryn, "Use Kandryn Agents");
  for (const s of all) {
    assert.doesNotMatch(s, /anthropic|openai|claude|gpt|sonnet|opus/i, s);
    assert.ok(!s.includes("—"), s);
  }
});

test("the policy note tells an admin what turning it off does NOT do", () => {
  // The fear this answers is "will I destroy my team's credentials".
  assert.match(POLICY_OFF_NOTE, /keep/i);
  assert.match(POLICY_OFF_NOTE, /stop being used/i);
});
