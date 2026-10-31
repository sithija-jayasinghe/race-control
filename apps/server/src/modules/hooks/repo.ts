import type { EventDecision, SessionStatus } from '@race-control/shared';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events, sessions } from '../../db/schema.ts';

/**
 * Creates the session on its first event, or updates it. Sessions are keyed by the agent's own session id
 * within the token's team, so the same id in another team is a different session.
 */
export async function upsertSession(
  db: DbOrTx,
  values: {
    teamId: string;
    userId: string;
    agentSessionId: string;
    cwd: string | null;
    repoName: string | null;
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
      repoName: values.repoName,
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
        repoName: sql`coalesce(${values.repoName}, ${sessions.repoName})`,
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
