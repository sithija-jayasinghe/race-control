import type { LiveMessage } from '@race-control/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { TeamBus } from '../../src/lib/team-bus.ts';
import { SESSION_COOKIE } from '../../src/plugins/auth.ts';
import { TEST_WEB_URL, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let teamId: string;
let token: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  token = (await lead.request('POST', `/teams/${teamId}/tokens`, { label: 'laptop' })).json<{ token: string }>().token;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await t.close();
});

/** Connects to a team's live channel and collects what arrives. */
async function connect(user: SignedInUser, team: string, origin = TEST_WEB_URL) {
  await t.app.ready();
  const messages: LiveMessage[] = [];
  const socket = await t.app.injectWS(
    `/teams/${team}/live`,
    { headers: { cookie: `${SESSION_COOKIE}=${user.cookie}`, origin } },
    // Listen before the connection opens, so the hello message isn't missed.
    { onInit: (ws) => ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString()) as LiveMessage)) },
  );
  sockets.push(socket);
  return { socket, messages };
}

function hook(bearer: string, event: string, body: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: `/hooks/${event}`,
    headers: { authorization: `Bearer ${bearer}` },
    payload: { session_id: 'sess-1', cwd: '/Users/nimal/code/api', hook_event_name: event, ...body },
  });
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('team live channel', () => {
  it('says hello, then pushes each session update and event as it happens', async () => {
    const { messages } = await connect(lead, teamId);
    await until(() => messages.length >= 1);
    expect(messages[0]).toEqual({ type: 'hello', teamId });

    await hook(token, 'PreToolUse', {
      tool_name: 'Edit',
      tool_input: { file_path: '/Users/nimal/code/api/src/app.ts', new_string: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt' },
    });
    await until(() => messages.length >= 3);

    expect(messages[1]).toMatchObject({
      type: 'session',
      session: { userEmail: 'lead@example.test', repoName: 'api', status: 'active', lastAction: 'edit src/app.ts' },
    });
    expect(messages[2]).toMatchObject({
      type: 'event',
      event: { type: 'PreToolUse', toolName: 'Edit', target: 'src/app.ts', summary: 'edit src/app.ts', decision: 'none' },
    });
    expect(JSON.stringify(messages)).not.toContain('sk-ant');
  });

  it("never sends one team's activity to another team", async () => {
    const other = await signInAs(t, 'other@example.test');
    const otherTeam = await createTeamAs(other, 'Other');
    const mine = await connect(lead, teamId);
    const theirs = await connect(other, otherTeam);
    await until(() => mine.messages.length >= 1 && theirs.messages.length >= 1);

    await hook(token, 'Stop', {});
    await until(() => mine.messages.length >= 3);
    await new Promise((r) => setTimeout(r, 50));

    expect(theirs.messages).toEqual([{ type: 'hello', teamId: otherTeam }]);
  });

  it("refuses people who aren't in the team", async () => {
    const outsider = await signInAs(t, 'outsider@example.test');

    await expect(connect(outsider, teamId)).rejects.toThrow(/404/);
  });

  it('refuses connections from other websites', async () => {
    await expect(connect(lead, teamId, 'https://evil.example')).rejects.toThrow(/403/);
  });

  it('stops listening when the browser disconnects', () => {
    const bus = new TeamBus();
    const unsubscribe = bus.subscribe(teamId, () => {});
    expect(bus.listenerCount(teamId)).toBe(1);
    unsubscribe();
    expect(bus.listenerCount(teamId)).toBe(0);
  });
});

describe('TeamBus', () => {
  it('keeps delivering when one listener throws', () => {
    const bus = new TeamBus();
    const got: string[] = [];
    bus.subscribe('a', () => {
      throw new Error('broken socket');
    });
    bus.subscribe('a', (m) => got.push(m.type));
    bus.subscribe('b', (m) => got.push(`b:${m.type}`));

    bus.publish('a', { type: 'hello', teamId: '11111111-1111-4111-8111-111111111111' });

    expect(got).toEqual(['hello']);
  });
});
