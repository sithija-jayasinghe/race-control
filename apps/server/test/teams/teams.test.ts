import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { addMember, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let dev: SignedInUser;
let teamId: string;

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

describe('POST /teams', () => {
  it('makes the creator the lead', async () => {
    const response = await dev.request('POST', '/teams', { name: '  Side Project ' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: expect.any(String) as string, name: 'Side Project', role: 'lead' });
    const me = await dev.request('GET', '/me');
    expect(me.json<{ teams: unknown[] }>().teams).toContainEqual(response.json());
  });

  it.each([{ name: '' }, { name: '   ' }, { name: 'x'.repeat(81) }, {}])('rejects %j', async (body) => {
    expect((await lead.request('POST', '/teams', body)).statusCode).toBe(400);
  });

  it('requires a login', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/teams', payload: { name: 'X' } })).statusCode).toBe(401);
  });
});

describe('GET /teams/:teamId', () => {
  it('shows the team and the caller’s role', async () => {
    expect((await lead.request('GET', `/teams/${teamId}`)).json()).toEqual({ id: teamId, name: 'BuildFlow', role: 'lead' });
    expect((await dev.request('GET', `/teams/${teamId}`)).json()).toEqual({
      id: teamId,
      name: 'BuildFlow',
      role: 'developer',
    });
  });

  it('answers a missing team and a team you are not in the same way', async () => {
    const outsider = await signInAs(t, 'outsider@example.test');

    const notMine = await outsider.request('GET', `/teams/${teamId}`);
    const missing = await outsider.request('GET', '/teams/00000000-0000-4000-8000-000000000000');

    expect([notMine.statusCode, notMine.body]).toEqual([404, '{"error":"not_found"}']);
    expect([missing.statusCode, missing.body]).toEqual([notMine.statusCode, notMine.body]);
  });

  it('rejects a malformed team id', async () => {
    expect((await lead.request('GET', '/teams/not-a-uuid')).statusCode).toBe(400);
  });
});

describe('GET /teams/:teamId/members', () => {
  it('lists members in the order they joined', async () => {
    const response = await dev.request('GET', `/teams/${teamId}/members`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { userId: lead.id, email: lead.email, name: null, role: 'lead', joinedAt: expect.any(String) as string },
      { userId: dev.id, email: dev.email, name: null, role: 'developer', joinedAt: expect.any(String) as string },
    ]);
  });
});

describe('PATCH /teams/:teamId/members/:userId', () => {
  it('lets a lead change a role', async () => {
    const response = await lead.request('PATCH', `/teams/${teamId}/members/${dev.id}`, { role: 'lead' });

    expect(response.statusCode).toBe(204);
    expect((await dev.request('GET', `/teams/${teamId}`)).json()).toMatchObject({ role: 'lead' });
  });

  it('does not let developers change roles', async () => {
    const response = await dev.request('PATCH', `/teams/${teamId}/members/${dev.id}`, { role: 'lead' });

    expect(response.statusCode).toBe(403);
  });

  it('never demotes the last lead', async () => {
    const response = await lead.request('PATCH', `/teams/${teamId}/members/${lead.id}`, { role: 'developer' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'last_lead' });
  });

  it('allows a lead to step down once there is another lead', async () => {
    await lead.request('PATCH', `/teams/${teamId}/members/${dev.id}`, { role: 'lead' });

    const response = await lead.request('PATCH', `/teams/${teamId}/members/${lead.id}`, { role: 'developer' });

    expect(response.statusCode).toBe(204);
  });

  it('answers 404 for someone who is not in the team', async () => {
    const outsider = await signInAs(t, 'outsider@example.test');

    const response = await lead.request('PATCH', `/teams/${teamId}/members/${outsider.id}`, { role: 'lead' });

    expect(response.statusCode).toBe(404);
  });

  it('rejects an unknown role', async () => {
    const response = await lead.request('PATCH', `/teams/${teamId}/members/${dev.id}`, { role: 'admin' });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /teams/:teamId/members/:userId', () => {
  it('lets a lead remove a member, who then loses access and their tokens', async () => {
    await t.db.insert(schema.devTokens).values({ teamId, userId: dev.id, tokenHash: 'hash', label: 'laptop' });

    const response = await lead.request('DELETE', `/teams/${teamId}/members/${dev.id}`);

    expect(response.statusCode).toBe(204);
    expect((await dev.request('GET', `/teams/${teamId}`)).statusCode).toBe(404);
    expect(await t.db.$count(schema.devTokens)).toBe(0);
  });

  it('lets a developer leave', async () => {
    expect((await dev.request('DELETE', `/teams/${teamId}/members/${dev.id}`)).statusCode).toBe(204);
  });

  it('does not let a developer remove someone else', async () => {
    expect((await dev.request('DELETE', `/teams/${teamId}/members/${lead.id}`)).statusCode).toBe(403);
  });

  it('never removes the last lead', async () => {
    const response = await lead.request('DELETE', `/teams/${teamId}/members/${lead.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'last_lead' });
  });
});
