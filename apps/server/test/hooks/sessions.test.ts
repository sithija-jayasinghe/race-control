import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_PUBLIC_URL,
  addMember,
  createTeamAs,
  createTestApp,
  signInAs,
  type SignedInUser,
  type TestApp,
} from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let dev: SignedInUser;
let teamId: string;

async function tokenFor(user: SignedInUser) {
  return (await user.request('POST', `/teams/${teamId}/tokens`, { label: 'laptop' })).json<{ token: string }>().token;
}

function hook(token: string, event: string, body: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: `/hooks/${event}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { hook_event_name: event, ...body },
  });
}

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  dev = await signInAs(t, 'dev@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  await addMember(lead, teamId, dev, 'developer');
});

afterEach(async () => {
  await t.close();
});

describe('GET /teams/:teamId/sessions', () => {
  it('lists sessions, most recently active first, with who and what they last did', async () => {
    const leadToken = await tokenFor(lead);
    const devToken = await tokenFor(dev);
    await hook(leadToken, 'SessionStart', { session_id: 'a', cwd: '/Users/l/code/api', source: 'startup' });
    t.clock.advance(1000);
    await hook(devToken, 'PreToolUse', {
      session_id: 'b',
      cwd: '/Users/d/code/web',
      tool_name: 'Edit',
      tool_input: { file_path: '/Users/d/code/web/src/app.tsx', new_string: 'secret' },
    });
    t.clock.advance(1000);
    await hook(devToken, 'Stop', { session_id: 'b', cwd: '/Users/d/code/web' });

    const response = await dev.request('GET', `/teams/${teamId}/sessions`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        userEmail: 'dev@example.test',
        repoName: 'web',
        status: 'idle',
        lastAction: 'finished responding',
        agent: 'claude_code',
        endedAt: null,
      }),
      expect.objectContaining({ userEmail: 'lead@example.test', repoName: 'api', status: 'active', lastAction: 'session startup' }),
    ]);
    expect(response.body).not.toContain('secret');
  });

  it("is invisible to other teams", async () => {
    const outsider = await signInAs(t, 'outsider@example.test');
    await createTeamAs(outsider, 'Other');

    const response = await outsider.request('GET', `/teams/${teamId}/sessions`);

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /setup/hooks', () => {
  it('tells signed-in people where agents send hooks', async () => {
    const response = await lead.request('GET', '/setup/hooks');

    expect(response.json()).toEqual({ hooksUrl: `${TEST_PUBLIC_URL}/hooks` });
  });

  it('requires a login', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/setup/hooks' })).statusCode).toBe(401);
  });
});
