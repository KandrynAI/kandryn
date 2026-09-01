import crypto from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  teamsTable,
  teamMembersTable,
  teamInvitesTable,
  teamIntegrationsTable,
  type Team,
} from "@workspace/db";
import { PLAN_LIMITS, type TeamPlan, type TeamRole } from "../../../../shared/types/team.js";
import { getConfig, getConfigs, type ConfigKey } from "./configService.js";
import { encryptSecret, decryptSecret } from "./configCrypto.js";

export class TeamError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

/** The user's primary team membership (earliest joined), with the team row. */
export async function getTeamForUser(
  userId: string,
): Promise<{ team: Team; role: TeamRole } | null> {
  const [row] = await db
    .select({ team: teamsTable, role: teamMembersTable.role })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamMembersTable.teamId, teamsTable.id))
    .where(eq(teamMembersTable.userId, userId))
    .orderBy(asc(teamMembersTable.joinedAt))
    .limit(1);
  return row ? { team: row.team, role: row.role } : null;
}

export async function getUserRole(userId: string, teamId: number): Promise<TeamRole | null> {
  const [member] = await db
    .select({ role: teamMembersTable.role })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.teamId, teamId)));
  return member?.role ?? null;
}

/** Create a team and make the user its admin. */
export async function createTeam(userId: string, name: string): Promise<Team> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || null;
  const [team] = await db
    .insert(teamsTable)
    .values({ name, slug, ownerUserId: userId, plan: "free" })
    .returning();
  await db.insert(teamMembersTable).values({ teamId: team.id, userId, role: "admin" });
  return team;
}

/**
 * Idempotently ensure the user has a team, and return it.
 *
 * Called at the moment a project is created — not on every request, and not
 * during onboarding, where `GET /teams/me` returning `{team: null}` is what
 * sends a brand-new user to /setup. The guarantee is narrower and enough: by
 * the time a project exists, its owner is the admin of a team, so every
 * resource-level admin check has someone to resolve to.
 *
 * Race-safe. The check-then-create was previously two statements, so two
 * concurrent first-project creates by the same user would both observe "no
 * team" and create two. The advisory lock serialises them per user, and the
 * re-check inside the lock is what actually prevents the duplicate — the lock
 * alone would not. A transaction-scoped lock is released on commit or
 * rollback, so a failure here cannot strand it.
 */
export async function ensureUserHasTeam(userId: string, displayName?: string): Promise<Team> {
  const existing = await getTeamForUser(userId);
  if (existing) return existing.team;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const [row] = await tx
      .select({ team: teamsTable })
      .from(teamMembersTable)
      .innerJoin(teamsTable, eq(teamMembersTable.teamId, teamsTable.id))
      .where(eq(teamMembersTable.userId, userId))
      .orderBy(asc(teamMembersTable.joinedAt))
      .limit(1);
    if (row) return row.team;

    const name = displayName ?? `Team ${userId.slice(-6)}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || null;
    const [team] = await tx
      .insert(teamsTable)
      .values({ name, slug, ownerUserId: userId, plan: "free" })
      .returning();
    await tx.insert(teamMembersTable).values({ teamId: team.id, userId, role: "admin" });
    return team;
  });
}

export async function createInvite(
  teamId: number,
  invitedBy: string,
  email: string,
  role: TeamRole,
) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) throw new TeamError("Team not found.", 404);

  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const limits = PLAN_LIMITS[team.plan as TeamPlan];
  const adminCount = members.filter((m) => m.role === "admin").length;
  const memberCount = members.filter((m) => m.role === "member").length;
  if (role === "admin" && adminCount >= limits.admins) throw new TeamError("Admin limit reached for this plan.", 409);
  if (role === "member" && memberCount >= limits.members) throw new TeamError("Member limit reached for this plan.", 409);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  try {
    const [invite] = await db
      .insert(teamInvitesTable)
      .values({ teamId, invitedBy, email, role, token, expiresAt })
      .returning();
    return invite;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new TeamError("This email has already been invited.", 409);
    throw err;
  }
}

export async function acceptInvite(token: string, userId: string) {
  const [invite] = await db.select().from(teamInvitesTable).where(eq(teamInvitesTable.token, token));
  if (!invite) throw new TeamError("Invite not found.", 404);
  if (invite.acceptedAt) throw new TeamError("Invite already accepted.", 409);
  if (new Date(invite.expiresAt) < new Date()) throw new TeamError("Invite has expired.", 410);

  const [existing] = await db
    .select({ id: teamMembersTable.id })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, invite.teamId), eq(teamMembersTable.userId, userId)));
  if (existing) throw new TeamError("You are already a member of this team.", 409);

  await db.insert(teamMembersTable).values({ teamId: invite.teamId, userId, role: invite.role });
  await db.update(teamInvitesTable).set({ acceptedAt: new Date() }).where(eq(teamInvitesTable.id, invite.id));
  return invite;
}

export async function getTeamMembers(teamId: number) {
  return db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId))
    .orderBy(asc(teamMembersTable.joinedAt));
}

export async function removeMember(teamId: number, userId: string): Promise<void> {
  await db
    .delete(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
}

export async function setMemberRole(teamId: number, userId: string, role: TeamRole): Promise<void> {
  await db
    .update(teamMembersTable)
    .set({ role })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
}

export async function listInvites(teamId: number) {
  return db
    .select()
    .from(teamInvitesTable)
    .where(eq(teamInvitesTable.teamId, teamId))
    .orderBy(desc(teamInvitesTable.id));
}

export async function deleteInvite(teamId: number, inviteId: number): Promise<boolean> {
  const [deleted] = await db
    .delete(teamInvitesTable)
    .where(and(eq(teamInvitesTable.id, inviteId), eq(teamInvitesTable.teamId, teamId)))
    .returning({ id: teamInvitesTable.id });
  return Boolean(deleted);
}

export async function listTeamIntegrations(teamId: number) {
  const rows = await db
    .select({ key: teamIntegrationsTable.key, value: teamIntegrationsTable.value, setBy: teamIntegrationsTable.setBy, setAt: teamIntegrationsTable.setAt })
    .from(teamIntegrationsTable)
    .where(eq(teamIntegrationsTable.teamId, teamId))
    .orderBy(asc(teamIntegrationsTable.key));
  return rows.map((r) => ({ ...r, value: decryptSecret(r.value) }));
}

export async function setTeamIntegration(
  teamId: number,
  key: string,
  value: string,
  setBy: string,
): Promise<void> {
  const encrypted = encryptSecret(value);
  await db
    .insert(teamIntegrationsTable)
    .values({ teamId, key, value: encrypted, setBy })
    .onConflictDoUpdate({
      target: [teamIntegrationsTable.teamId, teamIntegrationsTable.key],
      set: { value: encrypted, setBy, setAt: new Date() },
    });
}

/**
 * Resolve a credential team-first, then personal (the key multi-tenancy rule).
 * Thin wrapper over configService so the logic lives in one place.
 */
export function resolveConfig(userId: string, teamId: number | null, key: string): Promise<string> {
  return getConfig(userId, key as ConfigKey, teamId);
}

export function resolveConfigs(
  userId: string,
  teamId: number | null,
  keys: string[],
): Promise<Partial<Record<string, string>>> {
  return getConfigs(userId, keys as ConfigKey[], teamId);
}
