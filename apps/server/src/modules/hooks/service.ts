import {
  EDIT_TOOLS,
  TEAM_RADIO_TOOLS,
  type HookPayload,
  type IngestedHookEvent,
  type SessionStatus,
  type TeamRadio,
} from '@race-control/shared';
import type { AppDeps } from '../../app.ts';
import { errorHeadline, hideHome, recordToolCall, redactSecrets, repoNameFromCwd } from '../../lib/redact.ts';
import { findYellowFlags } from '../flags/repo.ts';
import { findTeamRadio, radioMessage, radioName } from '../radio/service.ts';
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

const editTools: readonly string[] = EDIT_TOOLS;
const radioTools: readonly string[] = TEAM_RADIO_TOOLS;

/** What the hook replies with, beyond "no decision". */
export type HookOutcome = { additionalContext?: string };

/**
 * Records one hook event for the token's team and developer. Returns a Team Radio heads-up for the agent
 * when someone else on the team recently edited the file it's about to work on.
 */
export async function ingestHookEvent<E extends IngestedHookEvent>(
  deps: Pick<AppDeps, 'db' | 'now' | 'bus'>,
  auth: DevTokenAuth,
  event: E,
  payload: HookPayload<E>,
): Promise<HookOutcome> {
  const now = deps.now();
  const stored = toStoredEvent(event, payload);
  const repoName = repoNameFromCwd(payload.cwd);

  const decision = 'none' as const;
  const ids = await deps.db.transaction(async (tx) => {
    const sessionId = await repo.upsertSession(tx, {
      teamId: auth.teamId,
      userId: auth.userId,
      agentSessionId: payload.session_id,
      cwd: payload.cwd ? hideHome(payload.cwd).slice(0, 1000) : null,
      repoName,
      status: SESSION_STATUS[event],
      ended: event === 'SessionEnd',
      now,
    });
    // Team Radio: the heads-up is decided before the event is saved, so the event records that it carried one.
    let about: TeamRadio['about'] = [];
    if (event === 'PreToolUse' && stored.target && repoName && radioTools.includes(stored.toolName ?? '')) {
      about = await findTeamRadio(tx, { teamId: auth.teamId, userId: auth.userId, sessionId, repoName, target: stored.target, now });
      if (about.length > 0) stored.payload.radio = { about: about.map((d) => ({ userId: d.userId, name: radioName(d) })) };
    }
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
    return { sessionId, eventId, about };
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

  // An edit may raise or extend a yellow flag on that file.
  if (event === 'PreToolUse' && stored.target && session?.repoName && editTools.includes(stored.toolName ?? '')) {
    const [flag] = await findYellowFlags(deps.db, auth.teamId, now, { repoName: session.repoName, target: stored.target });
    if (flag) deps.bus.publish(auth.teamId, { type: 'flag', flag });
  }

  if (ids.about.length === 0 || !stored.target || !repoName) return {};
  deps.bus.publish(auth.teamId, {
    type: 'radio',
    radio: {
      eventId: ids.eventId,
      sessionId: ids.sessionId,
      repoName,
      target: stored.target,
      about: ids.about,
      createdAt: now.toISOString(),
    },
  });
  return { additionalContext: radioMessage(ids.about, stored.target, now) };
}
