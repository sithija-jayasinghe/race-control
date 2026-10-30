import type { HookPayload, IngestedHookEvent, SessionStatus } from '@race-control/shared';
import type { AppDeps } from '../../app.ts';
import { errorHeadline, hideHome, recordToolCall, redactSecrets, repoNameFromCwd } from '../../lib/redact.ts';
import { findSessionView, serializeSession } from '../sessions/repo.ts';
import type { DevTokenAuth } from '../tokens/service.ts';
import * as repo from './repo.ts';

/** What each event means for the session's status. */
const SESSION_STATUS: Record<IngestedHookEvent, SessionStatus> = {
  SessionStart: 'active',
  PreToolUse: 'active',
  PostToolUse: 'active',
  PostToolUseFailure: 'active',
  Stop: 'idle',
  SessionEnd: 'ended',
};

type StoredEvent = {
  toolName: string | null;
  target: string | null;
  summary: string;
  payload: Record<string, unknown>;
};

const clean = (value: string | undefined, max = 100) => (value ? redactSecrets(value).slice(0, max) : undefined);

/** Reduces a hook payload to what may be stored: no file contents, prompts, replies or tool output. */
function toStoredEvent<E extends IngestedHookEvent>(event: E, payload: HookPayload<E>): StoredEvent {
  const shared = {
    permission_mode: clean(payload.permission_mode, 50),
    subagent: clean(payload.agent_type),
  };

  if (event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') {
    const p = payload as HookPayload<'PreToolUse'> & HookPayload<'PostToolUseFailure'>;
    const call = recordToolCall(p.tool_name, p.tool_input, p.cwd);
    return {
      toolName: p.tool_name.slice(0, 200),
      target: call.target,
      summary: event === 'PostToolUseFailure' ? `${call.summary} · failed`.slice(0, 180) : call.summary,
      payload: {
        ...shared,
        tool_use_id: clean(p.tool_use_id, 200),
        input: call.input,
        ...(event === 'PostToolUseFailure' ? { error: errorHeadline(p.error), is_interrupt: p.is_interrupt } : {}),
      },
    };
  }
  if (event === 'SessionStart') {
    const p = payload as HookPayload<'SessionStart'>;
    return {
      toolName: null,
      target: null,
      summary: `session ${p.source ?? 'start'}`.slice(0, 80),
      payload: { ...shared, source: clean(p.source, 50), model: clean(p.model) },
    };
  }
  if (event === 'SessionEnd') {
    const p = payload as HookPayload<'SessionEnd'>;
    return {
      toolName: null,
      target: null,
      summary: `session ended${p.reason ? ` (${clean(p.reason, 50)})` : ''}`,
      payload: { ...shared, reason: clean(p.reason, 50) },
    };
  }
  // Stop: the reply text (`last_assistant_message`) is deliberately not stored.
  return { toolName: null, target: null, summary: 'finished responding', payload: shared };
}

/** Drops undefined values so the stored JSON stays small. */
function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/** Records one hook event for the token's team and developer. */
export async function ingestHookEvent<E extends IngestedHookEvent>(
  deps: Pick<AppDeps, 'db' | 'now' | 'bus'>,
  auth: DevTokenAuth,
  event: E,
  payload: HookPayload<E>,
): Promise<void> {
  const now = deps.now();
  const stored = toStoredEvent(event, payload);

  const decision = 'none' as const;
  const ids = await deps.db.transaction(async (tx) => {
    const sessionId = await repo.upsertSession(tx, {
      teamId: auth.teamId,
      userId: auth.userId,
      agentSessionId: payload.session_id,
      cwd: payload.cwd ? hideHome(payload.cwd).slice(0, 1000) : null,
      repoName: repoNameFromCwd(payload.cwd),
      status: SESSION_STATUS[event],
      ended: event === 'SessionEnd',
      now,
    });
    const eventId = await repo.insertEvent(tx, {
      teamId: auth.teamId,
      sessionId,
      type: event,
      toolName: stored.toolName,
      target: stored.target,
      summary: stored.summary,
      payloadRedacted: compact(stored.payload),
      // Guardrails arrive in Week 4; until then Race Control never decides.
      decision,
      createdAt: now,
    });
    return { sessionId, eventId };
  });

  // Tell the team's dashboards, after the data is saved. Only redacted metadata goes out.
  const session = await findSessionView(deps.db, auth.teamId, ids.sessionId);
  if (session) deps.bus.publish(auth.teamId, { type: 'session', session: serializeSession(session) });
  deps.bus.publish(auth.teamId, {
    type: 'event',
    event: {
      id: ids.eventId,
      sessionId: ids.sessionId,
      type: event,
      toolName: stored.toolName,
      target: stored.target,
      summary: stored.summary,
      decision,
      createdAt: now.toISOString(),
    },
  });
}
