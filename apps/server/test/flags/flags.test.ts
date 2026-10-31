import type { LiveMessage, YellowFlag } from '@race-control/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YELLOW_FLAG_WINDOW_MS, flagsFromEdits } from '../../src/modules/flags/repo.ts';
import { addMember, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let dev: SignedInUser;
let teamId: string;
let leadToken: string;
let devToken: string;

async function tokenFor(user: SignedInUser, team = teamId) {
  return (await user.request('POST', `/teams/${team}/tokens`, { label: 'laptop' })).json<{ token: string }>().token;
}

/** One tool call from an agent working in `~/code/<repo>`. */
function toolCall(token: string, session: string, tool: string, file: string, repo = 'api') {
  const cwd = `/Users/someone/code/${repo}`;
  return t.app.inject({
    method: 'POST',
    url: '/hooks/PreToolUse',
    headers: { authorization: `Bearer ${token}` },
    payload: { hook_event_name: 'PreToolUse', session_id: session, cwd, tool_name: tool, tool_input: { file_path: `${cwd}/${file}` } },
  });
}

const flags = async (user: SignedInUser = lead) => (await user.request('GET', `/teams/${teamId}/flags`)).json<YellowFlag[]>();

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  dev = await signInAs(t, 'dev@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  await addMember(lead, teamId, dev, 'developer');
  leadToken = await tokenFor(lead);
  devToken = await tokenFor(dev);
});

afterEach(async () => {
  await t.close();
});

describe('GET /teams/:teamId/flags', () => {
  it('raises a yellow flag when two sessions edit the same file in the same repo', async () => {
    await toolCall(leadToken, 'a', 'Edit', 'src/auth/session.ts');
    t.clock.advance(60_000);
    await toolCall(devToken, 'b', 'Write', 'src/auth/session.ts');

    const [flag, ...rest] = await flags();

    expect(rest).toEqual([]);
    expect(flag).toMatchObject({ id: 'api:src/auth/session.ts', repoName: 'api', target: 'src/auth/session.ts' });
    // Most recent first, and the flag lasts until the older edit leaves the window.
    expect(flag!.drivers.map((d) => d.userEmail)).toEqual(['dev@example.test', 'lead@example.test']);
    expect(flag!.expiresAt).toBe(new Date(Date.parse('2026-10-28T09:00:00Z') + YELLOW_FLAG_WINDOW_MS).toISOString());
  });

  it('ignores reads, other files, other repos and a single session editing alone', async () => {
    await toolCall(leadToken, 'a', 'Edit', 'src/app.ts');
    await toolCall(leadToken, 'a', 'Edit', 'src/app.ts');
    await toolCall(devToken, 'b', 'Read', 'src/app.ts');
    await toolCall(devToken, 'b', 'Edit', 'src/other.ts');
    await toolCall(devToken, 'c', 'Edit', 'src/app.ts', 'web');

    expect(await flags()).toEqual([]);
  });

  it("doesn't flag someone against themself, and shows each person once, by their latest session", async () => {
    await toolCall(devToken, 'a', 'Edit', 'README.md');
    t.clock.advance(1000);
    await toolCall(devToken, 'b', 'MultiEdit', 'README.md');
    expect(await flags()).toEqual([]);

    t.clock.advance(1000);
    await toolCall(leadToken, 'c', 'Edit', 'README.md');
    const [flag] = await flags();
    // Sessions are listed newest first: c (lead), b (dev), a (dev).
    const [c, b] = (await lead.request('GET', `/teams/${teamId}/sessions`)).json<Array<{ id: string }>>();

    expect(flag!.drivers.map((d) => d.sessionId)).toEqual([c!.id, b!.id]);
  });

  it('clears once the older edit is more than 30 minutes old', async () => {
    await toolCall(leadToken, 'a', 'Edit', 'src/app.ts');
    t.clock.advance(10 * 60_000);
    await toolCall(devToken, 'b', 'Edit', 'src/app.ts');
    t.clock.advance(YELLOW_FLAG_WINDOW_MS - 10 * 60_000 + 1);

    expect(await flags()).toEqual([]);
  });

  it('is invisible to other teams', async () => {
    await toolCall(leadToken, 'a', 'Edit', 'src/app.ts');
    await toolCall(devToken, 'b', 'Edit', 'src/app.ts');
    const outsider = await signInAs(t, 'outsider@example.test');
    const otherTeam = await createTeamAs(outsider, 'Other');
    await toolCall(await tokenFor(outsider, otherTeam), 'c', 'Edit', 'src/app.ts');

    expect((await outsider.request('GET', `/teams/${teamId}/flags`)).statusCode).toBe(404);
    expect((await outsider.request('GET', `/teams/${otherTeam}/flags`)).json()).toEqual([]);
  });

  it('requires a login', async () => {
    expect((await t.app.inject({ method: 'GET', url: `/teams/${teamId}/flags` })).statusCode).toBe(401);
  });
});

describe('yellow flags on the live channel', () => {
  it("tells only the team's dashboards, when an edit raises or extends a flag", async () => {
    const outsider = await signInAs(t, 'outsider@example.test');
    const otherTeam = await createTeamAs(outsider, 'Other');
    const mine: LiveMessage[] = [];
    const theirs: LiveMessage[] = [];
    t.bus.subscribe(teamId, (m) => mine.push(m));
    t.bus.subscribe(otherTeam, (m) => theirs.push(m));

    await toolCall(leadToken, 'a', 'Edit', 'src/app.ts');
    expect(mine.filter((m) => m.type === 'flag')).toEqual([]);
    await toolCall(devToken, 'b', 'Edit', 'src/app.ts');
    await toolCall(leadToken, 'a', 'Read', 'src/app.ts');

    const sent = mine.filter((m) => m.type === 'flag');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'flag', flag: { id: 'api:src/app.ts' } });
    expect(theirs).toEqual([]);
  });
});

describe('flagsFromEdits', () => {
  const edit = (sessionId: string, target: string | null, at: number, repoName: string | null = 'api') => ({
    sessionId,
    // One person per session here.
    userId: sessionId,
    userEmail: 'a@example.test',
    userName: null,
    agent: 'claude_code' as const,
    repoName,
    target,
    createdAt: new Date(at),
  });
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '33333333-3333-4333-8333-333333333333';

  it("skips edits without a repo or file, since they can't be compared", () => {
    expect(flagsFromEdits([edit(a, 'x.ts', 1, null), edit(b, 'x.ts', 2, null), edit(a, null, 1), edit(b, null, 2)])).toEqual([]);
  });

  it("uses each session's latest edit, newest flag first", () => {
    const result = flagsFromEdits([edit(a, 'x.ts', 1000), edit(b, 'x.ts', 2000), edit(a, 'x.ts', 3000), edit(a, 'y.ts', 5000), edit(b, 'y.ts', 4000)]);

    expect(result.map((f) => f.target)).toEqual(['y.ts', 'x.ts']);
    expect(result[1]!.drivers.map((d) => [d.sessionId, d.lastAt])).toEqual([
      [a, new Date(3000).toISOString()],
      [b, new Date(2000).toISOString()],
    ]);
  });
});
