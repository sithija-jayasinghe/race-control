import { z } from 'zod';

// Claude Code HTTP hook payloads (https://code.claude.com/docs/en/hooks, checked 2026-10-29).
// Lenient on purpose: unknown fields are allowed, because Claude Code adds fields between versions.

/** The hook events Race Control records. Others are accepted and ignored. */
export const INGESTED_HOOK_EVENTS = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SessionEnd',
] as const;
export type IngestedHookEvent = (typeof INGESTED_HOOK_EVENTS)[number];

export function isIngestedHookEvent(name: string): name is IngestedHookEvent {
  return (INGESTED_HOOK_EVENTS as readonly string[]).includes(name);
}

const common = {
  session_id: z.string().min(1).max(200),
  hook_event_name: z.string().min(1).max(100),
  cwd: z.string().max(4096).optional(),
  permission_mode: z.string().max(50).optional(),
  /** Set when the hook fires inside a subagent. */
  agent_id: z.string().max(200).optional(),
  agent_type: z.string().max(200).optional(),
};

const toolCall = {
  tool_name: z.string().min(1).max(200),
  tool_input: z.record(z.string(), z.unknown()).default({}),
  tool_use_id: z.string().max(200).optional(),
};

export const hookPayloadSchemas = {
  SessionStart: z.looseObject({ ...common, source: z.string().max(50).optional(), model: z.string().max(200).optional() }),
  PreToolUse: z.looseObject({ ...common, ...toolCall }),
  PostToolUse: z.looseObject({ ...common, ...toolCall }),
  PostToolUseFailure: z.looseObject({
    ...common,
    ...toolCall,
    error: z.string().optional(),
    is_interrupt: z.boolean().optional(),
    duration_ms: z.number().optional(),
  }),
  Stop: z.looseObject({ ...common, stop_hook_active: z.boolean().optional() }),
  SessionEnd: z.looseObject({ ...common, reason: z.string().max(100).optional() }),
} satisfies Record<IngestedHookEvent, z.ZodType>;

export type HookPayload<E extends IngestedHookEvent> = z.infer<(typeof hookPayloadSchemas)[E]>;
