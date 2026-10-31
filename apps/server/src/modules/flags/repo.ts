import { EDIT_TOOLS, type YellowFlag } from '@race-control/shared';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events, sessions, users } from '../../db/schema.ts';

/** Two people editing the same file within this window share a yellow flag (docs/SPEC.md, Team Radio). */
export const YELLOW_FLAG_WINDOW_MS = 30 * 60 * 1000;
/** Safety cap on the edits read per check; a team won't come near it within one window. */
const MAX_EDITS = 5000;

export type Edit = {
  sessionId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  agent: YellowFlag['drivers'][number]['agent'];
  repoName: string | null;
  target: string | null;
  createdAt: Date;
};

/** One person's latest edit, as flags and Team Radio describe them. */
export function toDriver(edit: Edit): YellowFlag['drivers'][number] {
  return {
    sessionId: edit.sessionId,
    userId: edit.userId,
    userEmail: edit.userEmail,
    userName: edit.userName,
    agent: edit.agent,
    lastAt: edit.createdAt.toISOString(),
  };
}

/**
 * Groups edits by repo and file, and keeps the files that two or more people edited. Each person
 * counts once, by their latest session: someone restarting their agent doesn't clash with themself.
 */
export function flagsFromEdits(edits: Edit[], windowMs = YELLOW_FLAG_WINDOW_MS): YellowFlag[] {
  const byFile = new Map<string, { repoName: string; target: string; drivers: Map<string, Edit> }>();
  for (const edit of edits) {
    // Without a repo name there's no telling whether two paths are the same file.
    if (!edit.repoName || !edit.target) continue;
    const id = `${edit.repoName}:${edit.target}`;
    const file = byFile.get(id) ?? { repoName: edit.repoName, target: edit.target, drivers: new Map<string, Edit>() };
    const latest = file.drivers.get(edit.userId);
    if (!latest || edit.createdAt > latest.createdAt) file.drivers.set(edit.userId, edit);
    byFile.set(id, file);
  }

  const flags: YellowFlag[] = [];
  for (const [id, file] of byFile) {
    if (file.drivers.size < 2) continue;
    const drivers = [...file.drivers.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // The flag lasts while at least two people's latest edits are inside the window.
    const expiresAt = new Date(drivers[1]!.createdAt.getTime() + windowMs);
    flags.push({
      id,
      repoName: file.repoName,
      target: file.target,
      drivers: drivers.map(toDriver),
      expiresAt: expiresAt.toISOString(),
    });
  }
  return flags.sort((a, b) => b.drivers[0]!.lastAt.localeCompare(a.drivers[0]!.lastAt));
}

/**
 * A team's edits inside the flag window, optionally to one file. Built only from stored metadata:
 * who, which file, when.
 */
export async function recentEdits(
  db: DbOrTx,
  teamId: string,
  now: Date,
  file?: { repoName: string; target: string },
): Promise<Edit[]> {
  const since = new Date(now.getTime() - YELLOW_FLAG_WINDOW_MS);
  return db
    .select({
      sessionId: events.sessionId,
      userId: sessions.userId,
      userEmail: users.email,
      userName: users.name,
      agent: sessions.agent,
      repoName: sessions.repoName,
      target: events.target,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(sessions, and(eq(sessions.teamId, events.teamId), eq(sessions.id, events.sessionId)))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(events.teamId, teamId),
        eq(sessions.teamId, teamId),
        eq(events.type, 'PreToolUse'),
        inArray(events.toolName, [...EDIT_TOOLS]),
        isNotNull(events.target),
        gte(events.createdAt, since),
        file ? eq(events.target, file.target) : undefined,
        file ? eq(sessions.repoName, file.repoName) : undefined,
      ),
    )
    .limit(MAX_EDITS);
}

/** A team's current yellow flags, newest first. Pass `file` to check just one file (after an edit). */
export async function findYellowFlags(
  db: DbOrTx,
  teamId: string,
  now: Date,
  file?: { repoName: string; target: string },
): Promise<YellowFlag[]> {
  return flagsFromEdits(await recentEdits(db, teamId, now, file));
}
