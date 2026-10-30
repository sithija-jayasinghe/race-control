import { describe, expect, it } from 'vitest';
import { INGESTED_HOOK_EVENTS, buildHookSettings, hookPayloadSchemas } from '../src/index.ts';

describe('buildHookSettings', () => {
  const settings = buildHookSettings('https://rc.example/hooks/');

  it('sends every recorded event to its own URL, reading the token from the environment', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([...INGESTED_HOOK_EVENTS].sort());
    for (const event of INGESTED_HOOK_EVENTS) {
      const hook = settings.hooks[event][0]!.hooks[0]!;
      expect(hook).toMatchObject({
        type: 'http',
        url: `https://rc.example/hooks/${event}`,
        headers: { Authorization: 'Bearer $RACE_CONTROL_TOKEN' },
        allowedEnvVars: ['RACE_CONTROL_TOKEN'],
      });
    }
  });

  it('matches every tool, and gives PreToolUse time for approvals', () => {
    expect(settings.hooks.PreToolUse[0]).toMatchObject({ matcher: '*', hooks: [{ timeout: 300 }] });
    expect(settings.hooks.PostToolUse[0]!.matcher).toBe('*');
    expect(settings.hooks.SessionEnd[0]!.hooks[0]).not.toHaveProperty('timeout');
  });

  it('never contains a token', () => {
    expect(JSON.stringify(settings)).not.toMatch(/rc_[A-Za-z0-9]/);
  });
});

describe('hookPayloadSchemas', () => {
  it('accepts fields from newer Claude Code versions', () => {
    const parsed = hookPayloadSchemas.SessionStart.parse({
      session_id: 's',
      hook_event_name: 'SessionStart',
      source: 'startup',
      some_future_field: 42,
    });

    expect(parsed).toMatchObject({ session_id: 's', some_future_field: 42 });
  });

  it('requires a session id and tool name', () => {
    expect(hookPayloadSchemas.Stop.safeParse({ hook_event_name: 'Stop' }).success).toBe(false);
    expect(hookPayloadSchemas.PreToolUse.safeParse({ session_id: 's', hook_event_name: 'PreToolUse' }).success).toBe(false);
  });
});
