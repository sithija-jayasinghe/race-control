import { STARTER_RULES, type LiveMessage, type SessionTimeline } from '@race-control/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { RULE_CACHE_MS } from '../../src/modules/rules/cache.ts';
import { addMember, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let teamId: string;
let token: string;

async function tokenFor(user: SignedInUser, team = teamId) {
  return (await user.request('POST', `/teams/${team}/tokens`, { label: 'laptop' })).json<{ token: string }>().token;
}

/** One tool call from an agent working in `~/code/api`. */
function toolCall(tool: string, input: Record<string, unknown>, options: { token?: string; session?: string } = {}) {
  return t.app.inject({
    method: 'POST',
    url: '/hooks/PreToolUse',
    headers: { authorization: `Bearer ${options.token ?? token}` },
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: options.session ?? 's1',
      cwd: '/Users/someone/code/api',
      tool_name: tool,
      tool_input: input,
    },
  });
}
const editFile = (file: string, options?: { token?: string; session?: string }) =>
  toolCall('Edit', { file_path: `/Users/someone/code/api/${file}`, old_string: 'a', new_string: 'b' }, options);

/** Changes a team's starter rule, the way the Rules page will. */
async function setRule(name: string, values: Partial<typeof schema.rules.$inferInsert>, team = teamId) {
  await t.db
    .update(schema.rules)
    .set(values)
    .where(and(eq(schema.rules.teamId, team), eq(schema.rules.name, name)));
}

const lastEvent = async () => {
  const rows = await t.db.select().from(schema.events).orderBy(schema.events.createdAt);
  return rows.at(-1)!;
};

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  token = await tokenFor(lead);
});

afterEach(async () => {
  await t.close();
});

describe('starter rules', () => {
  it('are added to every new team, in shadow mode', async () => {
    const rules = await t.db.select().from(schema.rules).where(eq(schema.rules.teamId, teamId)).orderBy(schema.rules.createdAt);

    expect(rules.map((r) => [r.name, r.mode, r.enabled])).toEqual(STARTER_RULES.map((r) => [r.name, 'shadow', true]));
  });
});

describe('rules on PreToolUse', () => {
  it('in shadow mode, records what would have matched and changes nothing', async () => {
    const response = await editFile('.env');

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    const event = await lastEvent();
    expect(event.decision).toBe('none');
    expect(event.payloadRedacted).toMatchObject({ shadow: [{ name: 'Never touch .env files', action: 'block' }] });
  });

  it('blocks with deny, shows the agent the rule, and tells the dashboard', async () => {
    await setRule('Never touch .env files', { mode: 'enforce' });
    const live: LiveMessage[] = [];
    t.bus.subscribe(teamId, (m) => live.push(m));

    const response = await editFile('apps/api/.env.local');

    expect(response.json()).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Blocked by team rule: Never touch .env files',
      },
    });
    expect(live.find((m) => m.type === 'event')).toMatchObject({ event: { decision: 'deny', target: 'apps/api/.env.local' } });
    const event = await lastEvent();
    expect(event.payloadRedacted).toMatchObject({ rule: { name: 'Never touch .env files', action: 'block' } });

    const timeline = (await lead.request('GET', `/teams/${teamId}/sessions/${event.sessionId}`)).json<SessionTimeline>();
    expect(timeline.events.at(-1)).toMatchObject({ decision: 'deny', detail: 'Blocked by rule: Never touch .env files' });
  });

  it('falls back to the developer’s own prompt for an enforced approval rule', async () => {
    await setRule('Migrations need a lead', { mode: 'enforce' });

    const response = await toolCall('Write', { file_path: '/Users/someone/code/api/db/migrations/0042.sql', content: 'x' });

    expect(response.json()).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Race Control team rule: Migrations need a lead',
      },
    });
    expect((await lastEvent()).decision).toBe('ask');
  });

  it('matches Bash rules on the real command but never stores its secrets', async () => {
    await t.db.insert(schema.rules).values({
      teamId,
      name: 'No live Stripe keys in commands',
      tool: 'Bash',
      pattern: 'curl*sk_live_*',
      action: 'block',
      mode: 'enforce',
    });

    const response = await toolCall('Bash', { command: 'curl -u sk_live_51HxAbCdEfGhIjKl: https://api.stripe.com/v1/charges' });

    expect(response.json()).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    expect(JSON.stringify(await t.db.select().from(schema.events))).not.toContain('sk_live_51');
  });

  it('ignores disabled rules', async () => {
    await setRule('Never touch .env files', { mode: 'enforce', enabled: false });

    expect((await editFile('.env')).body).toBe('');
  });

  it("never applies another team's rules", async () => {
    const outsider = await signInAs(t, 'outsider@example.test');
    const otherTeam = await createTeamAs(outsider, 'Other');
    await setRule('Never touch .env files', { mode: 'enforce' }, otherTeam);

    expect((await editFile('.env')).body).toBe('');
    expect((await editFile('.env', { token: await tokenFor(outsider, otherTeam), session: 'z' })).json()).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });

  it('sends no Team Radio and raises no yellow flag for a blocked edit', async () => {
    const dev = await signInAs(t, 'dev@example.test');
    await addMember(lead, teamId, dev, 'developer');
    await setRule('Never touch .env files', { mode: 'enforce' });
    await t.db.insert(schema.rules).values({ teamId, name: 'README is frozen', tool: 'Edit', pattern: 'README.md', action: 'block', mode: 'enforce' });
    await toolCall('Write', { file_path: '/Users/someone/code/api/README.md', content: 'x' });
    const live: LiveMessage[] = [];
    t.bus.subscribe(teamId, (m) => live.push(m));

    const response = await editFile('README.md', { token: await tokenFor(dev), session: 's2' });

    expect(response.json()).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Blocked by team rule: README is frozen' },
    });
    expect(live.filter((m) => m.type === 'radio' || m.type === 'flag')).toEqual([]);
  });

  it('picks up rule changes made elsewhere within 30 seconds', async () => {
    await editFile('.env');
    await setRule('Never touch .env files', { mode: 'enforce' });

    expect((await editFile('.env')).body).toBe('');
    t.clock.advance(RULE_CACHE_MS);
    expect((await editFile('.env')).json()).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
});
