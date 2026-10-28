import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { addMember, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

// Two teams, Alpha and Beta, each with a lead and a developer. Every team-scoped route is tried
// by Beta's lead against Alpha's data, and must neither succeed nor reveal that Alpha exists.

let t: TestApp;
let alphaLead: SignedInUser;
let alphaDev: SignedInUser;
let betaLead: SignedInUser;
let betaDev: SignedInUser;
let alphaId: string;
let betaId: string;
let alphaInviteId: string;
let snapshotBefore: unknown;

/** Everything Alpha's lead can see about Alpha. */
async function alphaSnapshot() {
  const [team, members, invites] = await Promise.all([
    alphaLead.request('GET', `/teams/${alphaId}`),
    alphaLead.request('GET', `/teams/${alphaId}/members`),
    alphaLead.request('GET', `/teams/${alphaId}/invites`),
  ]);
  return { team: team.json<unknown>(), members: members.json<unknown>(), invites: invites.json<unknown>() };
}

beforeAll(async () => {
  t = await createTestApp();
  alphaLead = await signInAs(t, 'alpha-lead@example.test');
  alphaDev = await signInAs(t, 'alpha-dev@example.test');
  betaLead = await signInAs(t, 'beta-lead@example.test');
  betaDev = await signInAs(t, 'beta-dev@example.test');
  alphaId = await createTeamAs(alphaLead, 'Alpha');
  betaId = await createTeamAs(betaLead, 'Beta');
  await addMember(alphaLead, alphaId, alphaDev, 'developer');
  await addMember(betaLead, betaId, betaDev, 'developer');
  const invite = await alphaLead.request('POST', `/teams/${alphaId}/invites`, {});
  alphaInviteId = invite.json<{ id: string }>().id;
  snapshotBefore = await alphaSnapshot();
});

afterAll(async () => {
  await t.close();
});

type Case = [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: () => string, body?: object];

const alphaRoutes: Case[] = [
  ['GET', () => `/teams/${alphaId}`],
  ['GET', () => `/teams/${alphaId}/members`],
  ['PATCH', () => `/teams/${alphaId}/members/${alphaDev.id}`, { role: 'lead' }],
  ['DELETE', () => `/teams/${alphaId}/members/${alphaDev.id}`],
  ['POST', () => `/teams/${alphaId}/invites`, {}],
  ['GET', () => `/teams/${alphaId}/invites`],
  ['DELETE', () => `/teams/${alphaId}/invites/${alphaInviteId}`],
];

describe("another team's lead", () => {
  it.each(alphaRoutes)('gets 404 for %s %s', async (method, path, body) => {
    const response = await betaLead.request(method, path(), body);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });
});

describe('cross-team ids inside your own team', () => {
  it("can't change or remove a member of another team through their own team", async () => {
    expect((await betaLead.request('PATCH', `/teams/${betaId}/members/${alphaDev.id}`, { role: 'lead' })).statusCode).toBe(404);
    expect((await betaLead.request('DELETE', `/teams/${betaId}/members/${alphaDev.id}`)).statusCode).toBe(404);
  });

  it("can't revoke another team's invite through their own team", async () => {
    expect((await betaLead.request('DELETE', `/teams/${betaId}/invites/${alphaInviteId}`)).statusCode).toBe(404);
  });
});

describe('after all those attempts', () => {
  it("Alpha's data is unchanged", async () => {
    expect(await alphaSnapshot()).toEqual(snapshotBefore);
    expect(snapshotBefore).toMatchObject({
      members: [
        { userId: alphaLead.id, role: 'lead' },
        { userId: alphaDev.id, role: 'developer' },
      ],
      invites: expect.arrayContaining([expect.objectContaining({ id: alphaInviteId })]) as unknown,
    });
    expect(await t.db.$count(schema.memberships)).toBe(4);
  });

  it('/me lists only your own teams', async () => {
    const me = await betaDev.request('GET', '/me');
    expect(me.json<{ teams: Array<{ id: string }> }>().teams.map((team) => team.id)).toEqual([betaId]);
  });
});
