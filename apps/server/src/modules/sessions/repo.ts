import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events, sessions, users } from '../../db/schema.ts';

/** Sessions with who ran them and their latest action. Always filtered by team by the callers below. */
function selectSessionViews(db: DbOrTx, teamId: string) {
  return db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      userEmail: users.email,
      userName: users.name,
      agent: sessions.agent,
      repoName: sessions.repoName,
      status: sessions.status,
      startedAt: sessions.startedAt,
      lastEventAt: sessions.lastEventAt,
      endedAt: sessions.endedAt,
      lastAction: sql<string | null>`(
        select ${events.summary} from ${events}
        where ${events.sessionId} = ${sessions.id} and ${events.teamId} = ${teamId}
        order by ${events.createdAt} desc limit 1
      )`,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId));
}

export type SessionView = Awaited<ReturnType<typeof listRecentSessions>>[number];

/** A team's most recently active sessions, newest first, with each one's latest action. */
export async function listRecentSessions(db: DbOrTx, teamId: string, limit: number) {
  return selectSessionViews(db, teamId)
    .where(eq(sessions.teamId, teamId))
    .orderBy(desc(sessions.lastEventAt))
    .limit(limit);
}

/** One session of this team, or null. */
export async function findSessionView(db: DbOrTx, teamId: string, sessionId: string): Promise<SessionView | null> {
  const [row] = await selectSessionViews(db, teamId).where(and(eq(sessions.teamId, teamId), eq(sessions.id, sessionId)));
  return row ?? null;
}

/** Dates as ISO strings, the shape the API and live channel send. */
export function serializeSession(s: SessionView) {
  return {
    ...s,
    startedAt: s.startedAt.toISOString(),
    lastEventAt: s.lastEventAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}
