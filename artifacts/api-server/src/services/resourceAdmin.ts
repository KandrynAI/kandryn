/**
 * Who may administer one resource.
 *
 * `requireAdmin` answers a different question — "is this caller an admin of
 * their own team" — and it is the right gate for team-scoped COLLECTIONS
 * (/reports/admin/*, /audit, /teams/*). It is the wrong gate for an action on a
 * single resource, because it cannot see the resource: a team admin would pass
 * it while acting on another team's run, and the owner of a personal project —
 * which has no team, and therefore no admin to escalate to — would fail it with
 * no path forward.
 *
 * This rule was already written by hand in two places (projects PATCH and
 * DELETE) before the Aegis override and the baseline scan needed a third and
 * fourth. Centralised so the four cannot drift; a source-level guard keeps new
 * inline copies from appearing.
 */

export interface AdminActor {
  userId: string;
  teamId: number | null;
  teamRole: string | null;
}

export interface AdminResource {
  /** The user who owns the resource — projects.user_id, runs.user_id, … */
  ownerUserId: string;
  /** The team that owns it, or null for a personal resource. */
  teamId: number | null;
}

/**
 * A team-owned resource is administered by an admin OF THAT TEAM — never by an
 * admin of a different team. A resource with no team is administered by its
 * owner, who is the only party who could be responsible for it.
 */
export function canAdminister(actor: AdminActor, resource: AdminResource): boolean {
  return resource.teamId != null
    ? actor.teamRole === "admin" && actor.teamId === resource.teamId
    : actor.userId === resource.ownerUserId;
}
