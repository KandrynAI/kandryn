import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getTeamForUser,
  getTeamMembers,
  createTeam,
  ensureUserHasTeam,
  createInvite,
  acceptInvite,
  listInvites,
  deleteInvite,
  removeMember,
  setMemberRole,
  listTeamIntegrations,
  setTeamIntegration,
  TeamError,
} from "../services/teamService.js";
import { requireAdmin } from "../middlewares/team.js";
import { sendTeamInvite } from "../services/emailService.js";
import * as audit from "../services/auditService.js";
import { db, teamsTable, type Team } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AUDIT_RETENTION_DAYS } from "../../../../shared/types/auditLog.js";
import { getWorkspaceSettings, setWorkspaceSettings } from "../services/workspaceSettings.js";
import { platformAvailable } from "../services/modelKey.js";

const router: IRouter = Router();

/** Effective audit retention: the per-team override, else the plan default. */
function effectiveRetentionDays(team: Team): number {
  return team.auditRetentionDays ?? AUDIT_RETENTION_DAYS[team.plan] ?? 30;
}

// Credentials a workspace may own.
//
// This list used to exclude GITHUB_TOKEN and the agent keys on the grounds
// that they were personal. 0046 reverses that: a personal GitHub token dies
// with the person who made it, and agent credentials decide spend, which
// provider sees the code, and rotation. Those are organization decisions.
// A member may still override with their own, when the workspace allows it
// (teams.allow_personal_credentials); see services/gitToken.ts for the order.
const TEAM_CONFIG_KEYS = [
  "GITHUB_TOKEN",
  "AZURE_REPOS_ORG",
  "AZURE_REPOS_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "JIRA_DOMAIN",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "AZURE_DEVOPS_ORG",
  "AZURE_DEVOPS_PROJECT",
  "AZURE_DEVOPS_PAT",
  "CONFLUENCE_DOMAIN",
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_SPACE_KEY",
  "NOTION_API_TOKEN",
  "NOTION_PARENT_PAGE",
  "AEGIS_JIRA_ISSUE_TYPE",
] as const;

const TeamIdParam = z.object({ teamId: z.coerce.number().int().positive() });
const CreateTeamBody = z.object({ name: z.string().min(1).max(80) });
const InviteBody = z.object({ email: z.string().email().max(200), role: z.enum(["admin", "member"]) });
const AcceptBody = z.object({ token: z.string().min(1) });
const RoleBody = z.object({ role: z.enum(["admin", "member"]) });
const IntegrationBody = z.object({ key: z.enum(TEAM_CONFIG_KEYS), value: z.string().min(1).max(4000) });

function toTeamErr(res: import("express").Response, err: unknown): boolean {
  if (err instanceof TeamError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /teams/me — current user's team + role + member count (null if none).
router.get("/teams/me", async (req, res): Promise<void> => {
  const membership = await getTeamForUser(req.userId);
  if (!membership) {
    res.json({ team: null });
    return;
  }
  const members = await getTeamMembers(membership.team.id);
  res.json({
    team: membership.team,
    role: membership.role,
    memberCount: members.length,
    effectiveAuditRetentionDays: effectiveRetentionDays(membership.team),
  });
});

// PATCH /teams/:teamId/settings — team-level governance settings (admin only).
// Currently: audit-log retention override. null resets to the plan default.
const TeamSettingsBody = z.object({
  auditRetentionDays: z.number().int().min(1).max(3650).nullable(),
});
router.patch("/teams/:teamId/settings", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid team id" });
    return;
  }
  // requireAdmin confirms the caller is an admin of THEIR team; make sure the
  // path targets that same team, never another.
  if (req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "You can only change your own team's settings." });
    return;
  }
  const parsed = TeamSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }

  const [before] = await db.select().from(teamsTable).where(eq(teamsTable.id, params.data.teamId));
  if (!before) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const [team] = await db
    .update(teamsTable)
    .set({ auditRetentionDays: parsed.data.auditRetentionDays })
    .where(eq(teamsTable.id, params.data.teamId))
    .returning();

  if (before.auditRetentionDays !== parsed.data.auditRetentionDays) {
    audit.log({
      userId: req.userId,
      teamId: team.id,
      action: "team.updated",
      entityType: "team",
      entityId: team.id,
      metadata: { auditRetentionDays: { from: before.auditRetentionDays, to: parsed.data.auditRetentionDays } },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
  }

  res.json({ team, effectiveAuditRetentionDays: effectiveRetentionDays(team) });
});

// POST /teams — create a team (one per user for now).
router.post("/teams", async (req, res): Promise<void> => {
  const parsed = CreateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }
  if (await getTeamForUser(req.userId)) {
    res.status(409).json({ error: "You already belong to a team." });
    return;
  }
  const team = await createTeam(req.userId, parsed.data.name);
  req.log.info({ teamId: team.id }, "Team created");
  audit.log({
    userId: req.userId,
    teamId: team.id,
    action: "team.created",
    entityType: "team",
    entityId: team.id,
    metadata: { name: team.name },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.status(201).json({ team });
});

// POST /teams/bootstrap — auto-provision the user's first team (onboarding).
router.post("/teams/bootstrap", async (req, res): Promise<void> => {
  if (await getTeamForUser(req.userId)) {
    res.status(409).json({ error: "You already belong to a team." });
    return;
  }
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : undefined;
  const team = await ensureUserHasTeam(req.userId, name);
  req.log.info({ teamId: team.id }, "Team bootstrapped");
  audit.log({
    userId: req.userId,
    teamId: team.id,
    action: "team.created",
    entityType: "team",
    entityId: team.id,
    metadata: { name: team.name, bootstrap: true },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.status(201).json({ team });
});

// POST /invites/accept — accept an invite (must be signed in).
router.post("/invites/accept", async (req, res): Promise<void> => {
  const parsed = AcceptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "token is required." });
    return;
  }
  try {
    const invite = await acceptInvite(parsed.data.token, req.userId);
    req.log.info({ teamId: invite.teamId }, "Invite accepted");
    audit.log({
      userId: req.userId,
      teamId: invite.teamId,
      action: "member.joined",
      metadata: { role: invite.role },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json({ teamId: invite.teamId, role: invite.role });
  } catch (err) {
    if (toTeamErr(res, err)) return;
    throw err;
  }
});

// GET /teams/:teamId/members — members of the caller's team.
router.get("/teams/:teamId/members", async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid team id" });
    return;
  }
  if (req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  res.json(await getTeamMembers(params.data.teamId));
});

// POST /teams/:teamId/invites — invite a member (admin).
router.post("/teams/:teamId/invites", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  const body = InviteBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "email and role are required." });
    return;
  }
  if (req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  try {
    const invite = await createInvite(params.data.teamId, req.userId, body.data.email, body.data.role);
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, params.data.teamId));
    const base = process.env.APP_BASE_URL ?? "https://app.kandryn.com";
    await sendTeamInvite(body.data.email, team?.name ?? "your team", `${base}/invite?token=${invite.token}`).catch(
      (e) => req.log.warn({ err: e }, "Invite email failed"),
    );
    audit.log({
      userId: req.userId,
      teamId: req.teamId ?? null,
      action: "member.invited",
      metadata: { email: body.data.email, role: body.data.role },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(201).json({ invite });
  } catch (err) {
    if (toTeamErr(res, err)) return;
    throw err;
  }
});

// GET /teams/:teamId/invites — pending + accepted invites (admin).
router.get("/teams/:teamId/invites", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  res.json(await listInvites(params.data.teamId));
});

// DELETE /teams/:teamId/invites/:inviteId — cancel a pending invite (admin).
router.delete("/teams/:teamId/invites/:inviteId", requireAdmin, async (req, res): Promise<void> => {
  const params = z
    .object({ teamId: z.coerce.number().int().positive(), inviteId: z.coerce.number().int().positive() })
    .safeParse(req.params);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  const ok = await deleteInvite(params.data.teamId, params.data.inviteId);
  if (!ok) {
    res.status(404).json({ error: "Invite not found." });
    return;
  }
  res.sendStatus(204);
});

// DELETE /teams/:teamId/members/:userId — remove a member (admin; not the owner).
router.delete("/teams/:teamId/members/:userId", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  const targetUserId = String(req.params.userId);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, params.data.teamId));
  if (team?.ownerUserId === targetUserId) {
    res.status(409).json({ error: "The team owner cannot be removed." });
    return;
  }
  await removeMember(params.data.teamId, targetUserId);
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "member.removed",
    metadata: { removedUserId: targetUserId },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.sendStatus(204);
});

// PATCH /teams/:teamId/members/:userId — change a member's role (admin; not the owner).
router.patch("/teams/:teamId/members/:userId", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  const body = RoleBody.safeParse(req.body);
  const targetUserId = String(req.params.userId);
  if (!params.success || !body.success || req.teamId !== params.data.teamId) {
    res.status(400).json({ error: "role is required." });
    return;
  }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, params.data.teamId));
  if (team?.ownerUserId === targetUserId && body.data.role !== "admin") {
    res.status(409).json({ error: "The team owner must remain an admin." });
    return;
  }
  await setMemberRole(params.data.teamId, targetUserId, body.data.role);
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "member.role_changed",
    metadata: { targetUserId, newRole: body.data.role },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.json({ userId: targetUserId, role: body.data.role });
});

// ---------------------------------------------------------------------------
// GET /teams/:teamId/settings — the two settings an admin owns
//
// Readable by any member, because the Workspace tab shows every member what
// the workspace has decided; only the writes are admin-gated. Carries no
// credential and no environment variable name.
// ---------------------------------------------------------------------------
router.get("/teams/:teamId/settings", async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  const settings = await getWorkspaceSettings(params.data.teamId);
  res.json({
    ...settings,
    platformAvailable: platformAvailable(),
    canEdit: req.teamRole === "admin",
  });
});

const WorkspaceSettingsBody = z.object({
  agentKeySource: z.enum(["kandryn", "workspace_keys"]).optional(),
  allowPersonalCredentials: z.boolean().optional(),
});

// PUT /teams/:teamId/settings — admin only, enforced here and not in the UI.
router.put("/teams/:teamId/settings", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  const body = WorkspaceSettingsBody.safeParse(req.body);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "Invalid workspace settings" });
    return;
  }
  const teamId = params.data.teamId;

  // The server refuses what the screen disables, so a forged request cannot
  // park a workspace in a mode this deployment cannot serve.
  if (body.data.agentKeySource === "kandryn" && !platformAvailable()) {
    res.status(409).json({ error: "Kandryn Agents is not available in this environment." });
    return;
  }

  const before = await getWorkspaceSettings(teamId);
  await setWorkspaceSettings(teamId, body.data);

  // One entry per field that actually moved. Both values are safe to record:
  // neither is a credential.
  if (body.data.agentKeySource !== undefined && body.data.agentKeySource !== before.agentKeySource) {
    audit.log({
      userId: req.userId, teamId,
      action: "workspace_agent_source.changed",
      metadata: { from: before.agentKeySource, to: body.data.agentKeySource },
      ipAddress: audit.getIp(req), userAgent: req.headers["user-agent"],
    });
  }
  if (
    body.data.allowPersonalCredentials !== undefined &&
    body.data.allowPersonalCredentials !== before.allowPersonalCredentials
  ) {
    audit.log({
      userId: req.userId, teamId,
      action: "workspace_personal_credentials.changed",
      metadata: { from: before.allowPersonalCredentials, to: body.data.allowPersonalCredentials },
      ipAddress: audit.getIp(req), userAgent: req.headers["user-agent"],
    });
  }

  res.json(await getWorkspaceSettings(teamId));
});

// GET /teams/:teamId/integrations — team credentials (keys only, values masked).
router.get("/teams/:teamId/integrations", async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  const rows = await listTeamIntegrations(params.data.teamId);
  // Credential values stay masked; non-secret preferences return their value so
  // the UI can reflect the current selection.
  const PREF_KEYS = new Set(["AEGIS_JIRA_ISSUE_TYPE"]);
  res.json(
    rows.map((r) => ({
      key: r.key,
      setBy: r.setBy,
      setAt: r.setAt,
      masked: "••••••••",
      value: PREF_KEYS.has(r.key) ? r.value : undefined,
    })),
  );
});

// POST /teams/:teamId/integrations — set a shared team credential (admin).
router.post("/teams/:teamId/integrations", requireAdmin, async (req, res): Promise<void> => {
  const params = TeamIdParam.safeParse(req.params);
  const body = IntegrationBody.safeParse(req.body);
  if (!params.success || req.teamId !== params.data.teamId) {
    res.status(403).json({ error: "Not a member of this team." });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "key must be a shareable team credential and value is required." });
    return;
  }
  await setTeamIntegration(params.data.teamId, body.data.key, body.data.value, req.userId);
  req.log.info({ teamId: params.data.teamId, key: body.data.key }, "Team integration set");
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "team_credential.set",
    metadata: { key: body.data.key }, // NEVER the value
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.status(201).json({ key: body.data.key, setAt: new Date().toISOString() });
});

export default router;
