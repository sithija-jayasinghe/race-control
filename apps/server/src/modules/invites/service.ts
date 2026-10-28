import type { CreatedInvite, InvitePreview, MyTeam, Role } from '@race-control/shared';
import type { AppDeps } from '../../app.ts';
import { createSecureToken, hashToken } from '../../lib/secure-token.ts';
import type { TeamAuth } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Deps = Pick<AppDeps, 'db' | 'webUrl' | 'now'>;

/** Creates a reusable invite link. The link is returned once; only its hash is stored. */
export async function createInvite(deps: Deps, auth: TeamAuth, role: Role): Promise<CreatedInvite> {
  const now = deps.now();
  const token = createSecureToken();
  const invite = await repo.insertInvite(deps.db, {
    teamId: auth.teamId,
    tokenHash: hashToken(token),
    role,
    createdBy: auth.userId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    createdAt: now,
  });

  // Like magic links, the token goes in the fragment so it never reaches server logs.
  const url = new URL('/invite', deps.webUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return {
    id: invite.id,
    role: invite.role,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    url: url.toString(),
  };
}

/** What someone opening the link sees before signing in. Null for unknown, expired or revoked links. */
export async function previewInvite(deps: Deps, token: string): Promise<InvitePreview | null> {
  const invite = await repo.findActiveInviteByTokenHash(deps.db, hashToken(token), deps.now());
  if (!invite) return null;
  return { teamName: invite.teamName, role: invite.role, expiresAt: invite.expiresAt.toISOString() };
}

/** Joins the signed-in user to the invite's team. Members who are already in keep their role. */
export async function acceptInvite(deps: Deps, token: string, userId: string): Promise<MyTeam | null> {
  return deps.db.transaction(async (tx) => {
    const invite = await repo.findActiveInviteByTokenHash(tx, hashToken(token), deps.now());
    if (!invite) return null;
    const role = await repo.joinTeam(tx, invite.teamId, userId, invite.role);
    return { id: invite.teamId, name: invite.teamName, role };
  });
}
