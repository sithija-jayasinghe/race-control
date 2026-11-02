import { z } from 'zod';

// Claude Code HTTP hook payloads (https://code.claude.com/docs/en/hooks, checked 2026-10-29).
// Lenient on purpose: unknown fields are allowed, because Claude Code adds fields between versions.

/** The hook events Race Control records. Others are accepted and ignored. */
export const INGESTED_HOOK_EVENTS = [
  'SessionStart',
  'CwdChanged',
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
  // Only updates which repo the session is in; not shown as a step.
  CwdChanged: z.looseObject({ ...common, old_cwd: z.string().max(4096).optional(), new_cwd: z.string().max(4096).optional() }),
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

/**
 * Sent by the session hook (SessionStart and CwdChanged), which asks git where the repo is: its top folder
 * and its remote, with any credentials removed on the developer's machine. Empty when it isn't a git repo.
 */
export const REPO_ROOT_HEADER = 'x-race-control-repo-root';
export const REPO_REMOTE_HEADER = 'x-race-control-repo-remote';

export const repoHeadersSchema = z.object({
  [REPO_ROOT_HEADER]: z.string().max(4096).optional().catch(undefined),
  [REPO_REMOTE_HEADER]: z.string().max(2000).optional().catch(undefined),
});

/** The environment variable that holds a developer's token on their machine. */
export const TOKEN_ENV_VAR = 'RACE_CONTROL_TOKEN';

/** Single-quotes a value for `sh`. */
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The session hook's command: asks git for the repo's top folder and remote (`upstream` first, so forks
 * match the team's repo), removes any `user:token@` from the remote, and posts the hook's JSON to Race
 * Control with both as headers. Output is discarded (SessionStart output would reach Claude) and it always
 * exits 0, so it can never get in the agent's way. Runs in Claude Code's current folder.
 */
export function sessionHookCommand(url: string): string {
  return [
    'r=$(git rev-parse --show-toplevel 2>/dev/null)',
    'u=$(git remote get-url upstream 2>/dev/null || git remote get-url origin 2>/dev/null)',
    `u=$(printf '%s' "$u" | sed -E 's#://[^/@]*@#://#')`,
    [
      'curl -sS -m 5 -o /dev/null -X POST',
      `-H "Authorization: Bearer $${TOKEN_ENV_VAR}"`,
      "-H 'Content-Type: application/json'",
      `-H "${REPO_ROOT_HEADER}: $r"`,
      `-H "${REPO_REMOTE_HEADER}: $u"`,
      `--data-binary @- ${shellQuote(url)}`,
    ].join(' '),
    'exit 0',
  ].join('; ');
}

/**
 * The `hooks` block of `.claude/settings.json` that sends a developer's agent activity to Race Control
 * (SPEC section 4). The token is read from the environment, never written into the file, so the file
 * can be committed and shared by the whole team.
 *
 * Session start and folder changes use a command hook, because only a command can ask git which repo
 * this is. Everything else is an HTTP hook.
 *
 * By default a tool call goes ahead when Race Control can't be reached (fail-open). `failClosed` blocks it
 * instead (`"onFailure": "block"`, Claude Code v2.1.295+), on `PreToolUse` only: a connection failure, a
 * timeout or any answer other than 2xx, including a missing or revoked token, then stops every tool call.
 */
export function buildHookSettings(hooksUrl: string, options: { failClosed?: boolean } = {}) {
  const base = hooksUrl.replace(/\/+$/, '');
  const hook = (event: IngestedHookEvent, timeout?: number) => ({
    type: 'http' as const,
    url: `${base}/${event}`,
    ...(timeout === undefined ? {} : { timeout }),
    headers: { Authorization: `Bearer $${TOKEN_ENV_VAR}` },
    allowedEnvVars: [TOKEN_ENV_VAR],
    ...(event === 'PreToolUse' && options.failClosed ? { onFailure: 'block' as const } : {}),
  });
  const sessionHook = (event: 'SessionStart' | 'CwdChanged') => [
    { hooks: [{ type: 'command' as const, command: sessionHookCommand(`${base}/${event}`), timeout: 10 }] },
  ];
  const toolHooks = (event: IngestedHookEvent, timeout?: number) => [{ matcher: '*', hooks: [hook(event, timeout)] }];
  return {
    hooks: {
      SessionStart: sessionHook('SessionStart'),
      CwdChanged: sessionHook('CwdChanged'),
      // 300 s leaves room for a lead to answer an approval, which Race Control gives up on after 4 minutes.
      PreToolUse: toolHooks('PreToolUse', 300),
      PostToolUse: toolHooks('PostToolUse'),
      PostToolUseFailure: toolHooks('PostToolUseFailure'),
      Stop: [{ hooks: [hook('Stop')] }],
      SessionEnd: [{ hooks: [hook('SessionEnd')] }],
    },
  };
}
