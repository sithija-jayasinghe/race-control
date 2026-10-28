import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { hashToken } from '../../src/lib/secure-token.ts';
import { INVITE_TTL_MS } from '../../src/modules/invites/service.ts';
import {
  TEST_WEB_URL,
  addMember,
  createTeamAs,
  createTestApp,
  inviteToken,
  signInAs,
  type SignedInUser,
  type TestApp,
} from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let teamId: string;

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
});

afterEach(async () => {
  await t.close();
});

async function createInvite(role?: 'lead' | 'developer') {
  const response = await lead.request('POST', `/teams/${teamId}/invites`, role ? { role } : {});
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; role: string; url: string; expiresAt: string }>();
}

const preview = (token: string) => t.app.inject({ method: 'POST', url: '/invites/preview', payload: { token } });

describe('creating invites', () => {
  it('returns a link to the dashboard with the token in the fragment, valid for 7 days', async () => {
    const invite = await createInvite();

    expect(invite.role).toBe('developer');
    expect(invite.url).toMatch(new RegExp(`^${TEST_WEB_URL}/invite#token=[\\w-]{43}$`));
    expect(new Date(invite.expiresAt).getTime()).toBe(t.clock.now().getTime() + INVITE_TTL_MS);
  });

  it('stores only a hash of the link', async () => {
    const invite = await createInvite();

    const [row] = await t.db.select().from(schema.invites);

    expect(row?.tokenHash).toBe(hashToken(inviteToken(invite.url)));
    expect(JSON.stringify(row)).not.toContain(inviteToken(invite.url));
  });

  it('is only allowed for leads', async () => {
    const dev = await signInAs(t, 'dev@example.test');
    await addMember(lead, teamId, dev, 'developer');

    expect((await dev.request('POST', `/teams/${teamId}/invites`, {})).statusCode).toBe(403);
    expect((await dev.request('GET', `/teams/${teamId}/invites`)).statusCode).toBe(403);
  });

  it('lists active invites to leads without the link', async () => {
    const invite = await createInvite('lead');

    const response = await lead.request('GET', `/teams/${teamId}/invites`);

    expect(response.json()).toEqual([
      { id: invite.id, role: 'lead', createdAt: expect.any(String) as string, expiresAt: invite.expiresAt },
    ]);
    expect(response.body).not.toContain(inviteToken(invite.url));
  });
});

describe('using an invite', () => {
  it('shows the team name and role before signing in', async () => {
    const invite = await createInvite();

    const response = await preview(inviteToken(invite.url));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ teamName: 'BuildFlow', role: 'developer', expiresAt: invite.expiresAt });
  });

  it('adds the signed-in user with the invite’s role', async () => {
    const invite = await createInvite('lead');
    const newcomer = await signInAs(t, 'new@example.test');

    const response = await newcomer.request('POST', '/invites/accept', { token: inviteToken(invite.url) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: teamId, name: 'BuildFlow', role: 'lead' });
  });

  it('can be used by several people', async () => {
    const token = inviteToken((await createInvite()).url);

    for (const email of ['a@example.test', 'b@example.test', 'c@example.test']) {
      const user = await signInAs(t, email);
      expect((await user.request('POST', '/invites/accept', { token })).statusCode).toBe(200);
    }
    expect(await t.db.$count(schema.memberships)).toBe(4);
  });

  it('keeps the role of someone who is already a member', async () => {
    const token = inviteToken((await createInvite('developer')).url);

    const response = await lead.request('POST', '/invites/accept', { token });

    expect(response.json()).toMatchObject({ role: 'lead' });
  });

  it('requires a login to accept', async () => {
    const token = inviteToken((await createInvite()).url);

    const response = await t.app.inject({ method: 'POST', url: '/invites/accept', payload: { token } });

    expect(response.statusCode).toBe(401);
  });

  it('stops working after 7 days', async () => {
    const token = inviteToken((await createInvite()).url);
    const newcomer = await signInAs(t, 'new@example.test');
    t.clock.advance(INVITE_TTL_MS);

    expect((await preview(token)).statusCode).toBe(400);
    const response = await newcomer.request('POST', '/invites/accept', { token });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_or_expired_invite' });
  });

  it('rejects an unknown link', async () => {
    expect((await preview('made-up')).statusCode).toBe(400);
  });
});

describe('revoking invites', () => {
  it('stops the link working and hides it from the list', async () => {
    const invite = await createInvite();
    const newcomer = await signInAs(t, 'new@example.test');

    expect((await lead.request('DELETE', `/teams/${teamId}/invites/${invite.id}`)).statusCode).toBe(204);

    expect((await newcomer.request('POST', '/invites/accept', { token: inviteToken(invite.url) })).statusCode).toBe(400);
    expect((await lead.request('GET', `/teams/${teamId}/invites`)).json()).toEqual([]);
    expect((await lead.request('DELETE', `/teams/${teamId}/invites/${invite.id}`)).statusCode).toBe(404);
  });
});
