import { DEV_TOKEN_PREFIX, type CreatedDevToken } from '@race-control/shared';
import type { AppDeps } from '../../app.ts';
import { createSecureToken, hashToken } from '../../lib/secure-token.ts';
import type { TeamAuth } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';

/** Active tokens one person may have in one team (one per machine is the usual case). */
export const MAX_ACTIVE_TOKENS = 10;
/** `last_used_at` is written at most this often, so busy hooks don't write on every call. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

type Deps = Pick<AppDeps, 'db' | 'now'>;

/** Creates a token for the caller. The token is returned once; only its hash is stored. */
export async function createDevToken(
  deps: Deps,
  auth: TeamAuth,
  label: string,
): Promise<CreatedDevToken | 'too_many_tokens'> {
  return deps.db.transaction(async (tx) => {
    if ((await repo.countActiveTokens(tx, auth.teamId, auth.userId)) >= MAX_ACTIVE_TOKENS) {
      return 'too_many_tokens';
    }
    const token = createSecureToken(DEV_TOKEN_PREFIX);
    const id = await repo.insertToken(tx, {
      teamId: auth.teamId,
      userId: auth.userId,
      tokenHash: hashToken(token),
      label,
      createdAt: deps.now(),
    });
    const created = await repo.findActiveToken(tx, auth.teamId, id);
    if (!created) throw new Error('token missing after insert');
    return { ...serializeToken(created), token };
  });
}

/** Developers see and revoke their own tokens; leads see and revoke everyone's in the team. */
export function visibleTo(auth: TeamAuth): string | undefined {
  return auth.role === 'lead' ? undefined : auth.userId;
}

export async function revokeDevToken(deps: Deps, auth: TeamAuth, tokenId: string): Promise<boolean> {
  const token = await repo.findActiveToken(deps.db, auth.teamId, tokenId);
  const owner = visibleTo(auth);
  // A developer asking about someone else's token gets the same answer as for a missing one.
  if (!token || (owner !== undefined && token.userId !== owner)) return false;
  return repo.revokeToken(deps.db, auth.teamId, tokenId, deps.now());
}

export type DevTokenAuth = { tokenId: string; teamId: string; userId: string };

/**
 * Turns a token from an `Authorization: Bearer` header into the team and developer it belongs to.
 * Null for anything else, including revoked tokens and tokens of removed members (whose tokens
 * are deleted with their membership). The hook endpoints (Week 2) authenticate with this.
 */
export async function verifyDevToken(deps: Deps, token: string): Promise<DevTokenAuth | null> {
  if (!token.startsWith(DEV_TOKEN_PREFIX) || token.length > 200) return null;

  const found = await repo.findActiveTokenByHash(deps.db, hashToken(token));
  if (!found) return null;

  const now = deps.now();
  if (!found.lastUsedAt || now.getTime() - found.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
    await repo.touchToken(deps.db, found.id, now, new Date(now.getTime() - TOUCH_INTERVAL_MS + 1));
  }
  return { tokenId: found.id, teamId: found.teamId, userId: found.userId };
}

export function serializeToken(row: Awaited<ReturnType<typeof repo.listActiveTokens>>[number]) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
