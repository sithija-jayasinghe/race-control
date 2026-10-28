import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { hashToken } from '../../src/lib/secure-token.ts';
import { MAX_ACTIVE_TOKENS, TOUCH_INTERVAL_MS, verifyDevToken } from '../../src/modules/tokens/service.ts';
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

async function createToken(user: SignedInUser, label = 'laptop') {
  const response = await user.request('POST', `/teams/${teamId}/tokens`, { label });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; token: string; label: string; userId: string }>();
}

const list = async (user: SignedInUser) =>
  (await user.request('GET', `/teams/${teamId}/tokens`)).json<Array<{ id: string }>>();
const verify = (token: string) => verifyDevToken({ db: t.db, now: t.clock.now }, token);

describe('creating a token', () => {
  it('returns an rc_ token once, for the caller, and is not cached', async () => {
    const response = await dev.request('POST', `/teams/${teamId}/tokens`, { label: ' work laptop ' });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      id: expect.any(String) as string,
      label: 'work laptop',
      userId: dev.id,
      userEmail: dev.email,
      createdAt: t.clock.now().toISOString(),
      lastUsedAt: null,
      token: expect.stringMatching(/^rc_[\w-]{43}$/) as string,
    });
  });

  it('stores only a hash', async () => {
    const { token } = await createToken(dev);

    const [row] = await t.db.select().from(schema.devTokens);

    expect(row?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('never shows the token again', async () => {
    const { token } = await createToken(dev);

    const response = await dev.request('GET', `/teams/${teamId}/tokens`);

    expect(response.body).not.toContain(token);
    expect(response.json()).toEqual([expect.not.objectContaining({ token: expect.anything() as unknown })]);
  });

  it.each([{ label: '' }, { label: '  ' }, { label: 'x'.repeat(61) }, {}])('rejects %j', async (body) => {
    expect((await dev.request('POST', `/teams/${teamId}/tokens`, body)).statusCode).toBe(400);
  });

  it(`allows at most ${MAX_ACTIVE_TOKENS} active tokens per person`, async () => {
    const created = [];
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) created.push(await createToken(dev, `machine ${i}`));

    const tooMany = await dev.request('POST', `/teams/${teamId}/tokens`, { label: 'one more' });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json()).toEqual({ error: 'too_many_tokens' });

    await dev.request('DELETE', `/teams/${teamId}/tokens/${created[0]!.id}`);
    expect((await dev.request('POST', `/teams/${teamId}/tokens`, { label: 'one more' })).statusCode).toBe(201);
  });
});

describe('listing tokens', () => {
  it('shows developers only their own tokens', async () => {
    const devToken = await createToken(dev);
    await createToken(lead);

    expect((await list(dev)).map((tk) => tk.id)).toEqual([devToken.id]);
  });

  it("shows leads everyone's tokens in the team", async () => {
    const devToken = await createToken(dev);
    t.clock.advance(1000);
    const leadToken = await createToken(lead);

    expect((await list(lead)).map((tk) => tk.id)).toEqual([leadToken.id, devToken.id]);
  });
});

describe('revoking tokens', () => {
  it('lets the owner revoke, after which the token stops working', async () => {
    const { id, token } = await createToken(dev);
    expect(await verify(token)).not.toBeNull();

    expect((await dev.request('DELETE', `/teams/${teamId}/tokens/${id}`)).statusCode).toBe(204);

    expect(await verify(token)).toBeNull();
    expect(await list(dev)).toEqual([]);
    expect((await dev.request('DELETE', `/teams/${teamId}/tokens/${id}`)).statusCode).toBe(404);
  });

  it("lets a lead revoke a developer's token", async () => {
    const { id } = await createToken(dev);

    expect((await lead.request('DELETE', `/teams/${teamId}/tokens/${id}`)).statusCode).toBe(204);
  });

  it("doesn't let a developer revoke someone else's token", async () => {
    const { id, token } = await createToken(lead);

    expect((await dev.request('DELETE', `/teams/${teamId}/tokens/${id}`)).statusCode).toBe(404);
    expect(await verify(token)).not.toBeNull();
  });
});

describe('verifyDevToken', () => {
  it('returns the team and developer', async () => {
    const { id, token } = await createToken(dev);

    expect(await verify(token)).toEqual({ tokenId: id, teamId, userId: dev.id });
  });

  it.each(['', 'rc_made-up', 'not-an-rc-token', `rc_${'a'.repeat(300)}`])('rejects %j', async (token) => {
    expect(await verify(token)).toBeNull();
  });

  it('stops working when the developer is removed from the team', async () => {
    const { token } = await createToken(dev);

    await lead.request('DELETE', `/teams/${teamId}/members/${dev.id}`);

    expect(await verify(token)).toBeNull();
  });

  it('belongs to the team it was created in, even for people in several teams', async () => {
    const otherTeamId = await createTeamAs(dev, 'Side project');
    const { token } = await createToken(dev);

    expect(await verify(token)).toMatchObject({ teamId });
    expect(otherTeamId).not.toBe(teamId);
  });

  it('records when it was last used, at most every 5 minutes', async () => {
    const { id, token } = await createToken(dev);
    const lastUsed = async () =>
      (await t.db.select().from(schema.devTokens).where(eq(schema.devTokens.id, id)))[0]?.lastUsedAt?.getTime();

    await verify(token);
    const first = t.clock.now().getTime();
    expect(await lastUsed()).toBe(first);

    t.clock.advance(TOUCH_INTERVAL_MS - 1);
    await verify(token);
    expect(await lastUsed()).toBe(first);

    t.clock.advance(1);
    await verify(token);
    expect(await lastUsed()).toBe(t.clock.now().getTime());
  });
});
