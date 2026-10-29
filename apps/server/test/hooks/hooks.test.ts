import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import {
  addMember,
  createTeamAs,
  createTestApp,
  signInAs,
  type SignedInUser,
  type TestApp,
} from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let teamId: string;
let token: string;

const CWD = '/Users/nimal/code/buildflow-api';

async function createToken(user: SignedInUser, team: string, label = 'laptop') {
  const response = await user.request('POST', `/teams/${team}/tokens`, { label });
  return response.json<{ token: string; id: string }>();
}

function hook(event: string, body: Record<string, unknown>, bearer: string | null = token) {
  return t.app.inject({
    method: 'POST',
    url: `/hooks/${event}`,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    payload: { session_id: 'sess-1', cwd: CWD, hook_event_name: event, ...body },
  });
}

const allSessions = () => t.db.select().from(schema.sessions);
const allEvents = () => t.db.select().from(schema.events).orderBy(schema.events.createdAt);

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  token = (await createToken(lead, teamId)).token;
});

afterEach(async () => {
  await t.close();
});

describe('authentication', () => {
  it('refuses requests without a valid token', async () => {
    expect((await hook('PreToolUse', { tool_name: 'Bash', tool_input: {} }, null)).statusCode).toBe(401);
    expect((await hook('PreToolUse', { tool_name: 'Bash', tool_input: {} }, 'rc_made-up-token-value-xxxxxxxxxxx')).statusCode).toBe(401);
    expect(await t.db.$count(schema.events)).toBe(0);
  });

  it('refuses a revoked token', async () => {
    const old = await createToken(lead, teamId, 'old');
    expect((await hook('Stop', {}, old.token)).statusCode).toBe(200);

    await lead.request('DELETE', `/teams/${teamId}/tokens/${old.id}`);

    expect((await hook('Stop', {}, old.token)).statusCode).toBe(401);
  });

  it('records when a token was last used', async () => {
    await hook('Stop', {});

    const [row] = await t.db.select().from(schema.devTokens).where(eq(schema.devTokens.teamId, teamId));
    expect(row!.lastUsedAt?.getTime()).toBe(t.clock.now().getTime());
  });

  it('stops accepting a removed member’s token', async () => {
    const dev = await signInAs(t, 'dev@example.test');
    await addMember(lead, teamId, dev, 'developer');
    const devToken = (await createToken(dev, teamId)).token;
    expect((await hook('Stop', {}, devToken)).statusCode).toBe(200);

    await lead.request('DELETE', `/teams/${teamId}/members/${dev.id}`);

    expect((await hook('Stop', {}, devToken)).statusCode).toBe(401);
  });
});

describe('answers', () => {
  it('answers PreToolUse with an empty 200, meaning "no decision"', async () => {
    const response = await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pnpm test' }, tool_use_id: 'toolu_1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('accepts events it doesn’t record, without storing anything', async () => {
    const response = await hook('Notification', { message: 'Claude needs your permission' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(await t.db.$count(schema.sessions)).toBe(0);
  });

  it('rejects malformed payloads', async () => {
    const noSession = await t.app.inject({
      method: 'POST',
      url: '/hooks/PreToolUse',
      headers: { authorization: `Bearer ${token}` },
      payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    });
    const wrongEvent = await hook('PreToolUse', { hook_event_name: 'Stop', tool_name: 'Bash', tool_input: {} });

    expect(noSession.statusCode).toBe(400);
    expect(wrongEvent.statusCode).toBe(400);
    expect(await t.db.$count(schema.events)).toBe(0);
  });

  it('accepts large tool output without storing it', async () => {
    const output = 'x'.repeat(2 * 1024 * 1024);

    const response = await hook('PostToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: `${CWD}/big.log` },
      tool_response: { content: output },
    });

    expect(response.statusCode).toBe(200);
    const [event] = await allEvents();
    expect(JSON.stringify(event!.payloadRedacted).length).toBeLessThan(500);
  });
});

describe('sessions', () => {
  it('starts a session for the token’s developer and team, named after the repo folder', async () => {
    await hook('SessionStart', { source: 'startup', model: 'claude-opus-5', transcript_path: '/Users/nimal/.claude/x.jsonl' });

    const [session] = await allSessions();
    expect(session).toMatchObject({
      teamId,
      userId: lead.id,
      agent: 'claude_code',
      agentSessionId: 'sess-1',
      repoName: 'buildflow-api',
      cwd: '~/code/buildflow-api',
      status: 'active',
      endedAt: null,
    });
    const [event] = await allEvents();
    expect(event).toMatchObject({ type: 'SessionStart', summary: 'session startup', decision: 'none' });
    expect(JSON.stringify(event)).not.toContain('transcript');
  });

  it('creates the session from any first event, in case SessionStart was missed', async () => {
    await hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/README.md` } });

    expect(await allSessions()).toHaveLength(1);
  });

  it('goes idle on Stop, ends on SessionEnd, and comes back on resume', async () => {
    await hook('SessionStart', { source: 'startup' });
    await hook('Stop', { stop_hook_active: false, last_assistant_message: 'Here is the secret plan' });
    expect((await allSessions())[0]!.status).toBe('idle');

    t.clock.advance(60_000);
    await hook('SessionEnd', { reason: 'prompt_input_exit' });
    const ended = (await allSessions())[0]!;
    expect(ended.status).toBe('ended');
    expect(ended.endedAt?.getTime()).toBe(t.clock.now().getTime());

    t.clock.advance(60_000);
    await hook('SessionStart', { source: 'resume' });
    const resumed = (await allSessions())[0]!;
    expect(resumed).toMatchObject({ status: 'active', endedAt: null });
    expect(resumed.lastEventAt.getTime()).toBe(t.clock.now().getTime());

    const events = await allEvents();
    expect(events.map((e) => e.summary)).toEqual([
      'session startup',
      'finished responding',
      'session ended (prompt_input_exit)',
      'session resume',
    ]);
    expect(JSON.stringify(events)).not.toContain('secret plan');
  });
});

describe('what gets stored', () => {
  it('keeps the file an edit touched, never what it wrote', async () => {
    await hook('PreToolUse', {
      tool_name: 'Edit',
      tool_input: {
        file_path: `${CWD}/src/auth/session.ts`,
        old_string: 'const KEY = "old"',
        new_string: 'const KEY = "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt"',
      },
      tool_use_id: 'toolu_9',
    });

    const [event] = await allEvents();
    expect(event).toMatchObject({
      type: 'PreToolUse',
      toolName: 'Edit',
      target: 'src/auth/session.ts',
      summary: 'edit src/auth/session.ts',
    });
    expect(event!.payloadRedacted).toEqual({ tool_use_id: 'toolu_9', input: { file_path: 'src/auth/session.ts' } });
  });

  it('redacts secrets in commands', async () => {
    await hook('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'curl -H "Authorization: Bearer abc.def-ghi_123456" https://api.test' },
    });

    const [event] = await allEvents();
    expect(event!.target).toBe('curl -H "Authorization: Bearer [REDACTED]" https://api.test');
    expect(JSON.stringify(event)).not.toContain('abc.def-ghi');
  });

  it('keeps only the first line of a tool failure', async () => {
    await hook('PostToolUseFailure', {
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      error: 'Exit code 1\nFAIL src/db.test.ts: password=hunter2 rejected',
      is_interrupt: false,
      duration_ms: 4187,
    });

    const [event] = await allEvents();
    expect(event!.summary).toBe('bash pnpm test · failed');
    expect(event!.payloadRedacted).toMatchObject({ error: 'Exit code 1', is_interrupt: false });
    expect(JSON.stringify(event)).not.toContain('hunter2');
  });

  it('notes subagents', async () => {
    await hook('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' }, agent_id: 'a1', agent_type: 'Explore' });

    expect((await allEvents())[0]!.payloadRedacted).toMatchObject({ subagent: 'Explore' });
  });
});

describe('team isolation', () => {
  it('files events under the token’s team, even for the same agent session id', async () => {
    const otherLead = await signInAs(t, 'other@example.test');
    const otherTeam = await createTeamAs(otherLead, 'Other');
    const otherToken = (await createToken(otherLead, otherTeam)).token;

    await hook('SessionStart', { source: 'startup' });
    await hook('SessionStart', { source: 'startup' }, otherToken);

    const sessions = await allSessions();
    expect(sessions.map((s) => s.teamId).sort()).toEqual([teamId, otherTeam].sort());
    const events = await allEvents();
    for (const e of events) {
      expect(e.sessionId).toBe(sessions.find((s) => s.teamId === e.teamId)!.id);
    }
  });

  it('uses the team the token was made for, for people in several teams', async () => {
    const secondTeam = await createTeamAs(lead, 'Side project');

    await hook('Stop', {});

    expect((await allSessions()).map((s) => s.teamId)).toEqual([teamId]);
    expect(secondTeam).not.toBe(teamId);
  });
});
