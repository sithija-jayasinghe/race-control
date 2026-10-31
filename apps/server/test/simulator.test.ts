import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.ts';
import { describe as describeStep, readHookReply, runRace, type Send } from '../src/simulator/run.ts';
import { DEMO_TEAM_NAME, DRIVERS, LAP_MS, steps } from '../src/simulator/scenario.ts';
import { SimulatorSetupError, resetDemo, revokeSimulatorTokens, setupDemoTeam } from '../src/simulator/setup.ts';
import { createTeamAs, createTestApp, signInAs, type TestApp } from './helpers/app.ts';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

/** Sends through the real app, like the CLI does over HTTP. */
const injectSend: Send = async (event, token, body) => {
  const response = await t.app.inject({
    method: 'POST',
    url: `/hooks/${event}`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
  return readHookReply(response.statusCode, response.body);
};

/** A clock that jumps forward instead of waiting. */
function instantClock() {
  let now = 0;
  return { now: () => now, sleep: (ms: number) => ((now += ms), Promise.resolve()) };
}

describe('scenario', () => {
  it('starts and stops every driver, in time order, with absolute paths', () => {
    const lap = steps(1);

    expect(lap.map((s) => s.at)).toEqual([...lap.map((s) => s.at)].sort((a, b) => a - b));
    for (const driver of DRIVERS) {
      const own = lap.filter((s) => s.driver === driver.code);
      expect(own[0]!.event).toBe('SessionStart');
      expect(own.some((s) => s.event === 'Stop')).toBe(true);
    }
    const edit = lap.find((s) => s.event === 'PreToolUse' && s.body.tool_name === 'Edit')!;
    expect((edit.body.tool_input as { file_path: string }).file_path).toMatch(/^\/Users\/\w+\/code\/buildflow-/);
    expect(LAP_MS).toBeGreaterThan(30_000);
  });

  it('uses fresh session ids for each lap and each run', () => {
    expect(steps(1)[0]!.sessionId).not.toBe(steps(2)[0]!.sessionId);
    expect(steps(1, 'a')[0]!.sessionId).not.toBe(steps(1, 'b')[0]!.sessionId);
  });

  it('includes a collision, a failing test and a secret to redact', () => {
    const lap = steps(1);
    const sessionEdits = lap.filter(
      (s) => s.event === 'PreToolUse' && String((s.body.tool_input as { file_path?: string }).file_path).endsWith('src/auth/session.ts'),
    );
    expect(new Set(sessionEdits.map((s) => s.driver))).toEqual(new Set(['NIM', 'KAS']));
    expect(lap.some((s) => s.event === 'PostToolUseFailure')).toBe(true);
    expect(JSON.stringify(lap)).toContain('sk_live_');
  });

  it('describes steps without ever printing a secret', () => {
    const lines = steps(1).map(describeStep);

    expect(lines).toContain('● session start');
    expect(lines.some((l) => l.includes('✗ bash pnpm test'))).toBe(true);
    expect(lines.join('\n')).not.toContain('sk_live_');
  });
});

describe('setupDemoTeam', () => {
  it('creates the Demo team with a lead, five drivers and a token each', async () => {
    const demo = await setupDemoTeam(t.db, { now: t.clock.now() });

    const [team] = await t.db.select().from(schema.teams).where(eq(schema.teams.id, demo.teamId));
    expect(team!.name).toBe(DEMO_TEAM_NAME);
    expect(await t.db.$count(schema.memberships, eq(schema.memberships.teamId, demo.teamId))).toBe(6);
    expect([...demo.tokens.keys()]).toEqual(DRIVERS.map((d) => d.code));
    expect([...demo.tokens.values()].every((tk) => tk.startsWith('rc_'))).toBe(true);
  });

  it('reuses the Demo team on later runs', async () => {
    const first = await setupDemoTeam(t.db, { now: t.clock.now() });
    const second = await setupDemoTeam(t.db, { now: t.clock.now() });

    expect(second.teamId).toBe(first.teamId);
    expect(await t.db.$count(schema.teams)).toBe(1);
  });

  it('adds a viewer as a lead, and explains when they have no account', async () => {
    const viewer = await signInAs(t, 'me@example.test');

    const demo = await setupDemoTeam(t.db, { viewerEmail: ' Me@Example.TEST ', now: t.clock.now() });

    const me = await viewer.request('GET', '/me');
    expect(me.json<{ teams: Array<{ id: string; role: string }> }>().teams).toContainEqual(
      expect.objectContaining({ id: demo.teamId, role: 'lead' }),
    );
    await expect(setupDemoTeam(t.db, { viewerEmail: 'nobody@example.test', now: t.clock.now() })).rejects.toBeInstanceOf(
      SimulatorSetupError,
    );
  });

  it('never takes over a real team that happens to be called "Demo team"', async () => {
    const lead = await signInAs(t, 'real@example.test');
    const realTeam = await createTeamAs(lead, DEMO_TEAM_NAME);

    const demo = await setupDemoTeam(t.db, { now: t.clock.now() });

    expect(demo.teamId).not.toBe(realTeam);
  });
});

describe('runRace', () => {
  it('replays a lap through the hook endpoint and fills the Demo team', async () => {
    const demo = await setupDemoTeam(t.db, { now: t.clock.now() });
    const clock = instantClock();
    const lines: string[] = [];

    const stats = await runRace({ send: injectSend, tokens: demo.tokens, laps: 1, speed: 1, ...clock, log: (l) => lines.push(l) });

    expect(stats).toMatchObject({ sent: steps(1).length, failed: 0 });
    expect(await t.db.$count(schema.sessions, eq(schema.sessions.teamId, demo.teamId))).toBe(5);
    const stored = JSON.stringify(await t.db.select().from(schema.events));
    expect(stored).not.toContain('sk_live_');
    expect(stored).not.toContain('ALTER TABLE');
    expect(lines[0]).toMatch(/^NIM {2}● session start$/);
    // The Demo team enforces the .env and migration rules: Janith's edit is blocked, and Amaya's migration
    // waits for a lead, who doesn't answer in this test.
    expect(lines.filter((l) => l.includes('⛔'))).toEqual([
      'JAN  ⛔ deny: Blocked by team rule: Never touch .env files',
      'AMA  ⛔ deny: No approval within 1 second (team rule: Migrations need a lead)',
    ]);
    // Kasun's agent reads session.ts after Nimal edited it, and hears about it.
    expect(lines.filter((l) => l.includes('📻'))).toEqual([
      "KAS  📻 Race Control (team note): Nimal's Claude Code agent edited `src/auth/session.ts` less than a minute ago in another session. Those changes may not be in your copy yet.",
    ]);

    await runRace({ send: injectSend, tokens: demo.tokens, laps: 1, speed: 1, ...instantClock(), runId: 'second' });
    expect(await t.db.$count(schema.sessions, eq(schema.sessions.teamId, demo.teamId))).toBe(10);
  });

  it('keeps the scenario’s timing, scaled by speed', async () => {
    const demo = await setupDemoTeam(t.db, { now: t.clock.now() });
    const clock = instantClock();

    await runRace({ send: () => Promise.resolve({ status: 200 }), tokens: demo.tokens, laps: 1, speed: 4, ...clock });

    const last = Math.max(...steps(1).map((s) => s.at));
    expect(clock.now()).toBeGreaterThanOrEqual(last / 4);
    expect(clock.now()).toBeLessThan(last / 4 + 50);
  });

  it('counts failed sends, and stops when asked', async () => {
    const demo = await setupDemoTeam(t.db, { now: t.clock.now() });
    let sends = 0;

    const stats = await runRace({
      send: () => Promise.resolve({ status: ++sends === 1 ? 500 : 200 }),
      tokens: demo.tokens,
      laps: Number.POSITIVE_INFINITY,
      speed: 1,
      ...instantClock(),
      stopped: () => sends >= 3,
    });

    expect(stats).toMatchObject({ sent: 3, failed: 1 });
  });
});

describe('cleaning up', () => {
  it('revokes the run’s tokens, and reset removes only demo data', async () => {
    const lead = await signInAs(t, 'real@example.test');
    const realTeam = await createTeamAs(lead, 'BuildFlow');
    const demo = await setupDemoTeam(t.db, { viewerEmail: 'real@example.test', now: t.clock.now() });
    await runRace({ send: injectSend, tokens: demo.tokens, laps: 1, speed: 1, ...instantClock() });

    await revokeSimulatorTokens(t.db, demo.tokenIds, t.clock.now());
    expect(await injectSend('Stop', demo.tokens.get('NIM')!, { session_id: 'x', hook_event_name: 'Stop' })).toMatchObject({ status: 401 });

    const removed = await resetDemo(t.db);

    expect(removed).toEqual({ teams: 1, users: 6 });
    expect(await t.db.$count(schema.sessions)).toBe(0);
    expect((await t.db.select().from(schema.teams)).map((team) => team.id)).toEqual([realTeam]);
    expect(await t.db.$count(schema.users, eq(sql`lower(${schema.users.email})`, 'real@example.test'))).toBe(1);
  });
});
