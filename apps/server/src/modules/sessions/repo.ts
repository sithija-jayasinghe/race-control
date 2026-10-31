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
      toolCalls: sql<number>`(
        select count(*)::int from ${events}
        where ${events.sessionId} = ${sessions.id} and ${events.teamId} = ${teamId} and ${events.type} = 'PreToolUse'
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

/** A team's most recent events, oldest first, for the live map and feed. */
export async function listRecentEvents(db: DbOrTx, teamId: string, limit: number) {
  const rows = await db
    .select({
      id: events.id,
      sessionId: events.sessionId,
      type: events.type,
      toolName: events.toolName,
      target: events.target,
      summary: events.summary,
      decision: events.decision,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.teamId, teamId))
    .orderBy(desc(events.createdAt))
    .limit(limit);
  return rows.reverse().map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
}

/** The detail shown on a timeline step, picked from the stored (already redacted) payload. */
function detailFrom(type: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const pick = (key: string) => {
    const value = p[key];
    return typeof value === 'string' ? value : null;
  };
  if (type === 'PostToolUseFailure') return pick('error');
  const rule = p.rule as { name?: unknown; action?: unknown } | undefined;
  if (type === 'PreToolUse' && typeof rule?.name === 'string') {
    if (rule.action === 'block') return `Blocked by rule: ${rule.name}`;
    const approval = p.approval as { status?: unknown; by?: unknown } | undefined;
    const by = typeof approval?.by === 'string' ? ` by ${approval.by}` : '';
    if (approval?.status === 'approved') return `Approved${by}, rule: ${rule.name}`;
    if (approval?.status === 'denied') return `Denied${by}, rule: ${rule.name}`;
    if (approval?.status === 'expired') return `No answer in time, rule: ${rule.name}`;
    return `Waiting for a lead, rule: ${rule.name}`;
  }
  if (type === 'SessionEnd') return pick('reason');
  if (type === 'SessionStart') return [pick('source'), pick('model')].filter(Boolean).join(' · ') || null;
  return null;
}

/** Who a Team Radio heads-up on this step was about, from the names stored with it. */
function radioFrom(payload: unknown): string[] | null {
  const radio = ((payload ?? {}) as { radio?: { about?: Array<{ name?: unknown }> } }).radio;
  if (!radio || !Array.isArray(radio.about)) return null;
  return radio.about.map((p) => p.name).filter((name): name is string => typeof name === 'string');
}

/** One session's events, oldest first: the latest `limit`, and whether older ones were left out. */
export async function listSessionEvents(db: DbOrTx, teamId: string, sessionId: string, limit: number) {
  const rows = await db
    .select({
      id: events.id,
      sessionId: events.sessionId,
      type: events.type,
      toolName: events.toolName,
      target: events.target,
      summary: events.summary,
      decision: events.decision,
      createdAt: events.createdAt,
      payload: events.payloadRedacted,
    })
    .from(events)
    .where(and(eq(events.teamId, teamId), eq(events.sessionId, sessionId)))
    .orderBy(desc(events.createdAt))
    .limit(limit + 1);
  const truncated = rows.length > limit;
  const kept = rows.slice(0, limit).reverse();
  return {
    truncated,
    events: kept.map(({ payload, ...e }) => ({ ...e, createdAt: e.createdAt.toISOString(), detail: detailFrom(e.type, payload), radio: radioFrom(payload) })),
  };
}
