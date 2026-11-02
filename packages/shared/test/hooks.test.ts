import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INGESTED_HOOK_EVENTS, buildHookSettings, hookPayloadSchemas, sessionHookCommand } from '../src/index.ts';

const SESSION_EVENTS = ['SessionStart', 'CwdChanged'] as const;

describe('buildHookSettings', () => {
  const settings = buildHookSettings('https://rc.example/hooks/');

  it('sends every recorded event to its own URL, reading the token from the environment', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([...INGESTED_HOOK_EVENTS].sort());
    for (const event of INGESTED_HOOK_EVENTS.filter((e) => !(SESSION_EVENTS as readonly string[]).includes(e))) {
      const hook = settings.hooks[event as 'Stop'][0]!.hooks[0]!;
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

  it('lets tool calls carry on when Race Control is down, unless the team picks fail-closed', () => {
    expect(JSON.stringify(settings)).not.toContain('onFailure');

    const closed = buildHookSettings('https://rc.example/hooks', { failClosed: true });
    expect(closed.hooks.PreToolUse[0]!.hooks[0]).toMatchObject({ onFailure: 'block', timeout: 300 });
    // Only tool calls are stopped; recording what happened afterwards never blocks anything.
    expect(JSON.stringify({ ...closed.hooks, PreToolUse: [] })).not.toContain('onFailure');
  });

  it('asks git which repo this is when a session starts or changes folder', () => {
    for (const event of SESSION_EVENTS) {
      expect(settings.hooks[event]).toEqual([
        { hooks: [{ type: 'command', command: sessionHookCommand(`https://rc.example/hooks/${event}`), timeout: 10 }] },
      ]);
    }
  });

  it('never contains a token', () => {
    expect(JSON.stringify(settings)).not.toMatch(/rc_[A-Za-z0-9]/);
  });
});

describe('sessionHookCommand', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs the command in `cwd` with a fake curl that records what it was asked to send. */
  function run(cwd: string, remote?: string) {
    const bin = join(dir, 'bin');
    execFileSync('mkdir', ['-p', bin, cwd]);
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\ncat > "${dir}/body"\nexit 7\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    if (remote !== undefined) {
      execFileSync('git', ['init', '-q'], { cwd: join(dir, 'repo') });
      if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: join(dir, 'repo') });
    }
    const out = execFileSync('sh', ['-c', sessionHookCommand("https://rc.example/hooks/Session'Start")], {
      cwd,
      input: '{"session_id":"s1"}',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RACE_CONTROL_TOKEN: 'rc_test' },
    });
    return { out: out.toString(), args: readFileSync(join(dir, 'args'), 'utf8').split('\n'), body: readFileSync(join(dir, 'body'), 'utf8') };
  }

  it('sends the repo top folder and remote, without credentials, and prints nothing', () => {
    dir = mkdtempSync(join(tmpdir(), 'rc-hook-'));
    const { out, args, body } = run(join(dir, 'repo', 'apps', 'web'), 'https://nimal:ghp_secret123@github.com/org/api.git');

    expect(out).toBe('');
    expect(body).toBe('{"session_id":"s1"}');
    expect(args).toContain('Authorization: Bearer rc_test');
    expect(args.find((a) => a.startsWith('x-race-control-repo-root: '))).toMatch(/\/repo$/);
    expect(args).toContain('x-race-control-repo-remote: https://github.com/org/api.git');
    expect(args).toContain("https://rc.example/hooks/Session'Start");
    expect(args.join(' ')).not.toContain('ghp_secret123');
  });

  it('sends empty repo headers outside a git repo, and still exits 0', () => {
    dir = mkdtempSync(join(tmpdir(), 'rc-hook-'));
    const { args } = run(join(dir, 'plain'));

    expect(args).toContain('x-race-control-repo-root: ');
    expect(args).toContain('x-race-control-repo-remote: ');
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
