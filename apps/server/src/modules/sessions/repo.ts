import { desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events, sessions, users } from '../../db/schema.ts';

/** A team's most recently active sessions, newest first, with each one's latest action. */
export async function listRecentSessions(db: DbOrTx, teamId: string, limit: number) {
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
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.teamId, teamId))
    .orderBy(desc(sessions.lastEventAt))
    .limit(limit);
}
