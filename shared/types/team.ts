export type TeamPlan = 'free' | 'pro' | 'max' | 'enterprise';
export type TeamRole = 'admin' | 'member';

export interface Team {
  id: number;
  name: string;
  slug: string | null;
  ownerUserId: string;
  plan: TeamPlan;
  createdAt: string;
}

export interface TeamMember {
  id: number;
  teamId: number;
  userId: string;
  role: TeamRole;
  joinedAt: string;
  // Joined from Clerk if needed:
  email?: string;
  name?: string;
}

export interface TeamInvite {
  id: number;
  teamId: number;
  invitedBy: string;
  email: string;
  role: TeamRole;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
}

// Plan limits (admins / members per plan).
export const PLAN_LIMITS: Record<TeamPlan, { admins: number; members: number }> = {
  free: { admins: 1, members: 3 },
  pro: { admins: 2, members: 10 },
  max: { admins: 2, members: 20 },
  enterprise: { admins: 99, members: 999 },
};
