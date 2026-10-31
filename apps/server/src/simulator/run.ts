import type { IngestedHookEvent } from '@race-control/shared';
import { recordToolCall } from '../lib/redact.ts';
import { LAP_MS, steps, type Step } from './scenario.ts';

/** The HTTP status, plus a rule's decision and a Team Radio heads-up if the reply carried them. */
export type SendResult = { status: number; decision?: string; reason?: string; radio?: string };

/** Sends one hook event the way Claude Code does. */
export type Send = (event: IngestedHookEvent, token: string, body: Record<string, unknown>) => Promise<SendResult>;

/** Reads a hook reply the way Claude Code does: an empty body is "no decision", JSON may carry context. */
export function readHookReply(status: number, text: string): SendResult {
  if (!text) return { status };
  try {
    const output = (JSON.parse(text) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
    const pick = (key: string) => (typeof output[key] === 'string' ? output[key] : undefined);
    return {
      status,
      decision: pick('permissionDecision'),
      reason: pick('permissionDecisionReason'),
      radio: pick('additionalContext'),
    };
  } catch {
    return { status };
  }
}

/** Real HTTP to a running server's hook endpoint. */
export function httpSend(baseUrl: string): Send {
  const base = baseUrl.replace(/\/+$/, '');
  return async (event, token, body) => {
    const response = await fetch(`${base}/hooks/${event}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return readHookReply(response.status, await response.text());
  };
}

export type RaceStats = { sent: number; failed: number; p50Ms: number; p95Ms: number };

type RunOptions = {
  send: Send;
  /** Raw tokens by driver code. */
  tokens: Map<string, string>;
  laps: number;
  /** 2 runs twice as fast. */
  speed: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
  /** Return true to stop after the current event. */
  stopped?: () => boolean;
  /** Keeps session ids unique across runs. Defaults to a fresh id. */
  runId?: string;
  /** A reply slower than this is a request held for a lead: that driver waits, the others race on. */
  holdAfterMs?: number;
};

/** One readable line per event. Built from the redacted record, so secrets never reach the console. */
export function describe(step: Step & { cwd: string }): string {
  const { body } = step;
  if (step.event === 'PreToolUse' || step.event === 'PostToolUse' || step.event === 'PostToolUseFailure') {
    const summary = recordToolCall(body.tool_name as string, body.tool_input as Record<string, unknown>, step.cwd).summary;
    if (step.event === 'PreToolUse') return summary;
    return step.event === 'PostToolUse' ? `  ✓ ${summary}` : `  ✗ ${summary}`;
  }
  return { SessionStart: '● session start', Stop: '■ finished responding', SessionEnd: '○ session ended' }[step.event] ?? step.event;
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replays the scripted race through `send`, lap after lap, keeping the scenario's timing. */
export async function runRace({
  send,
  tokens,
  laps,
  speed,
  sleep = realSleep,
  now = () => performance.now(),
  log = () => {},
  stopped = () => false,
  runId = Date.now().toString(36),
  holdAfterMs = 1000,
}: RunOptions): Promise<RaceStats> {
  const latencies: number[] = [];
  let failed = 0;
  // Drivers waiting in the pit lane, and their steps since, sent in order once a lead answers.
  const held = new Map<string, Promise<void>>();

  const sendStep = async (step: Step & { sessionId: string; cwd: string }, token: string) => {
    const body = { session_id: step.sessionId, cwd: step.cwd, hook_event_name: step.event, ...step.body };
    const started = now();
    const { status, decision, reason, radio } = await send(step.event, token, body);
    // A held request's time is the lead's, not the hook's.
    const took = now() - started;
    if (took < holdAfterMs) latencies.push(took);
    if (status !== 200) failed++;
    log(`${step.driver}  ${describe(step)}${status === 200 ? '' : `  (HTTP ${status})`}`);
    if (decision) log(`${step.driver}  ${decision === 'allow' ? '🟢' : decision === 'deny' ? '⛔' : '✋'} ${decision}: ${reason ?? ''}`);
    if (radio) log(`${step.driver}  📻 ${radio}`);
  };

  for (let lap = 1; lap <= laps && !stopped(); lap++) {
    if (laps > 1) log(`— lap ${lap} —`);
    const lapStart = now();
    for (const step of steps(lap, runId)) {
      if (stopped()) break;
      const wait = step.at / speed - (now() - lapStart);
      if (wait > 0) await sleep(wait);

      const token = tokens.get(step.driver);
      if (!token) throw new Error(`no token for driver ${step.driver}`);
      const waiting = held.get(step.driver);
      if (waiting) {
        held.set(step.driver, waiting.then(() => sendStep(step, token)));
        continue;
      }
      const sent = sendStep(step, token);
      const quick = await Promise.race([sent.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), holdAfterMs))]);
      if (!quick) {
        log(`${step.driver}  ✋ waiting for a lead: approve or deny it on the Pit wall`);
        held.set(step.driver, sent);
      }
    }
    if (lap < laps && !stopped()) await sleep(Math.max(0, (LAP_MS - (now() - lapStart) * speed) / speed));
  }

  await Promise.all(held.values());
  latencies.sort((a, b) => a - b);
  return { sent: latencies.length, failed, p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95) };
}
