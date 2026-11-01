import type { EventDecision, SessionStatus } from '@race-control/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events, sessions } from '../../db/schema.ts';
import type { RepoContext } from '../../lib/repo.ts';

/** The repo a session last said it was in, if it has started. */
export async function findSessionRepo(db: DbOrTx, teamId: string, agentSessionId: string): Promise<RepoContext | null> {
  const [row] = await db
    .select({ key: sessions.repoKey, name: sessions.repoName, root: sessions.repoRoot })
    .from(sessions)
    .where(and(eq(sessions.teamId, teamId), eq(sessions.agent, 'claude_code'), eq(sessions.agentSessionId, agentSessionId)))
    .limit(1);
  return row?.key && row.name ? { key: row.key, name: row.name, root: row.root } : null;
}

/**
 * Creates the session on its first event, or updates it. Sessions are keyed by the agent's own session id
 * within the token's team, so the same id in another team is a different session.
 *
 * `repoUpdate` events (session start, changing folder) say which repo the session is in now. Other events
 * only fill it in when the session has none.
 */
export async function upsertSession(
  db: DbOrTx,
  values: {
    teamId: string;
    userId: string;
    agentSessionId: string;
    cwd: string | null;
    repo: RepoContext | null;
    repoUpdate: boolean;
    status: SessionStatus;
    ended: boolean;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values({
      teamId: values.teamId,
      userId: values.userId,
      agent: 'claude_code',
      agentSessionId: values.agentSessionId,
      cwd: values.cwd,
      repoName: values.repo?.name ?? null,
      repoKey: values.repo?.key ?? null,
      repoRoot: values.repo?.root ?? null,
      status: values.status,
      startedAt: values.now,
      endedAt: values.ended ? values.now : null,
      lastEventAt: values.now,
    })
    .onConflictDoUpdate({
      target: [sessions.teamId, sessions.agent, sessions.agentSessionId],
      set: {
        status: values.status,
        lastEventAt: values.now,
        endedAt: values.ended ? values.now : null,
        cwd: sql`coalesce(${values.cwd}, ${sessions.cwd})`,
        ...(values.repoUpdate && values.repo
          ? { repoName: values.repo.name, repoKey: values.repo.key, repoRoot: values.repo.root }
          : {
              repoName: sql`coalesce(${sessions.repoName}, ${values.repo?.name ?? null})`,
              repoKey: sql`coalesce(${sessions.repoKey}, ${values.repo?.key ?? null})`,
            }),
      },
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('session upsert returned nothing');
  return row.id;
}

export async function insertEvent(
  db: DbOrTx,
  values: {
    teamId: string;
    sessionId: string;
    type: string;
    toolName: string | null;
    target: string | null;
    repoKey: string | null;
    summary: string;
    payloadRedacted: Record<string, unknown>;
    decision: EventDecision;
    createdAt: Date;
  },
) {
  const [row] = await db.insert(events).values(values).returning({ id: events.id });
  if (!row) throw new Error('event insert returned nothing');
  return row.id;
}
