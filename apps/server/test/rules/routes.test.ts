import { MAX_RULES, STARTER_RULES, type Rule, type RulePreview, type RuleTestResult, type RuleWithStats } from '@race-control/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { addMember, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

let t: TestApp;
let lead: SignedInUser;
let dev: SignedInUser;
let teamId: string;
let token: string;

const rules = async (user: SignedInUser = lead, team = teamId) => (await user.request('GET', `/teams/${team}/rules`)).json<RuleWithStats[]>();
const ruleNamed = async (name: string) => (await rules()).find((r) => r.name === name)!;
const newRule = { name: 'Lockfiles need a lead', tool: 'Edit | Write', pattern: '**/pnpm-lock.yaml', action: 'approve' };

function editFile(file: string) {
  return t.app.inject({
    method: 'POST',
    url: '/hooks/PreToolUse',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      cwd: '/Users/someone/code/api',
      tool_name: 'Edit',
      tool_input: { file_path: `/Users/someone/code/api/${file}` },
    },
  });
}
function runCommand(command: string) {
  return t.app.inject({
    method: 'POST',
    url: '/hooks/PreToolUse',
    headers: { authorization: `Bearer ${token}` },
    payload: { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/Users/someone/code/api', tool_name: 'Bash', tool_input: { command } },
  });
}

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  dev = await signInAs(t, 'dev@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  await addMember(lead, teamId, dev, 'developer');
  token = (await lead.request('POST', `/teams/${teamId}/tokens`, { label: 'laptop' })).json<{ token: string }>().token;
});

afterEach(async () => {
  await t.close();
});

describe('GET /teams/:teamId/rules', () => {
  it('lists the rules, oldest first, to every member', async () => {
    const list = await rules(dev);

    expect(list.map((r) => [r.name, r.mode, r.enabled])).toEqual(STARTER_RULES.map((r) => [r.name, 'shadow', true]));
    expect(list[0]!.matches).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts each day’s matches, shadow and enforced, for the last 7 days', async () => {
    await editFile('.env');
    t.clock.advance(2 * 24 * 60 * 60 * 1000);
    await editFile('.env');
    await editFile('apps/.env.local');
    t.clock.advance(6 * 24 * 60 * 60 * 1000);
    await t.db.update(schema.rules).set({ mode: 'enforce' }).where(eq(schema.rules.name, 'Never touch .env files'));
    t.clock.advance(60_000);
    await editFile('.env');

    // The first edit is 8 days old and out of the window; the next two are just over 6 days old.
    expect((await ruleNamed('Never touch .env files')).matches).toEqual([2, 0, 0, 0, 0, 0, 1]);
  });

  it('is invisible to other teams, and needs a login', async () => {
    const outsider = await signInAs(t, 'outsider@example.test');
    await createTeamAs(outsider, 'Other');

    expect((await outsider.request('GET', `/teams/${teamId}/rules`)).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/teams/${teamId}/rules` })).statusCode).toBe(401);
  });
});

describe('POST /teams/:teamId/rules', () => {
  it('adds a rule in shadow mode, with tidy tool names', async () => {
    t.clock.advance(1000);
    const response = await lead.request('POST', `/teams/${teamId}/rules`, newRule);

    expect(response.statusCode).toBe(201);
    expect(response.json<Rule>()).toMatchObject({ name: 'Lockfiles need a lead', tool: 'Edit|Write', mode: 'shadow', enabled: true });
    expect((await rules()).at(-1)!.name).toBe('Lockfiles need a lead');
  });

  it('is for leads only', async () => {
    expect((await dev.request('POST', `/teams/${teamId}/rules`, newRule)).statusCode).toBe(403);
  });

  it.each([
    ['an empty name', { name: '  ' }],
    ['a long name', { name: 'x'.repeat(101) }],
    ['a bad tool list', { tool: 'Edit||Write' }],
    ['a tool with spaces', { tool: 'Edit Write' }],
    ['a control character', { pattern: 'a\u0000b' }],
    ['a long pattern', { pattern: 'x'.repeat(301) }],
    ['an unknown action', { action: 'allow' }],
  ])('rejects %s', async (_name, change) => {
    expect((await lead.request('POST', `/teams/${teamId}/rules`, { ...newRule, ...change })).statusCode).toBe(400);
  });

  it(`stops at ${MAX_RULES} rules`, async () => {
    await t.db.insert(schema.rules).values(
      Array.from({ length: MAX_RULES - STARTER_RULES.length }, (_, i) => ({ ...newRule, name: `Rule ${i}`, teamId, action: 'approve' as const })),
    );

    expect((await lead.request('POST', `/teams/${teamId}/rules`, newRule)).statusCode).toBe(409);
  });
});

describe('PATCH /teams/:teamId/rules/:ruleId', () => {
  it('turns a rule live, and the hook uses it straight away', async () => {
    await editFile('.env');
    const rule = await ruleNamed('Never touch .env files');

    const response = await lead.request('PATCH', `/teams/${teamId}/rules/${rule.id}`, { mode: 'enforce' });

    expect(response.json<Rule>()).toMatchObject({ mode: 'enforce' });
    expect((await editFile('.env')).json()).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('turns a rule off, and edits its other fields', async () => {
    const rule = await ruleNamed('Migrations need a lead');

    await lead.request('PATCH', `/teams/${teamId}/rules/${rule.id}`, { enabled: false, name: 'Schema changes need a lead', pattern: '**/schema.ts' });

    expect(await ruleNamed('Schema changes need a lead')).toMatchObject({ enabled: false, pattern: '**/schema.ts', action: 'approve' });
  });

  it('is for leads only, rejects empty changes, and never reaches another team’s rule', async () => {
    const rule = await ruleNamed('No rm -rf /');
    const outsider = await signInAs(t, 'outsider@example.test');
    const otherTeam = await createTeamAs(outsider, 'Other');

    expect((await dev.request('PATCH', `/teams/${teamId}/rules/${rule.id}`, { mode: 'enforce' })).statusCode).toBe(403);
    expect((await lead.request('PATCH', `/teams/${teamId}/rules/${rule.id}`, {})).statusCode).toBe(400);
    expect((await outsider.request('PATCH', `/teams/${otherTeam}/rules/${rule.id}`, { mode: 'enforce' })).statusCode).toBe(404);
    expect((await ruleNamed('No rm -rf /')).mode).toBe('shadow');
  });
});

describe('POST /teams/:teamId/rules/starter', () => {
  it('adds the starter rules to a team that has none, once', async () => {
    await t.db.delete(schema.rules).where(eq(schema.rules.teamId, teamId));

    expect((await lead.request('POST', `/teams/${teamId}/rules/starter`)).statusCode).toBe(204);
    expect(await rules()).toHaveLength(STARTER_RULES.length);
    expect((await lead.request('POST', `/teams/${teamId}/rules/starter`)).statusCode).toBe(409);
    expect((await dev.request('POST', `/teams/${teamId}/rules/starter`)).statusCode).toBe(403);
  });
});

describe('POST /teams/:teamId/rules/test', () => {
  const test = async (input: string, user = dev) => (await user.request('POST', `/teams/${teamId}/rules/test`, { input })).json<RuleTestResult>();

  it('says what would happen to an edit of a file, or a command', async () => {
    const env = await ruleNamed('Never touch .env files');
    const publish = await ruleNamed('Publishing needs a lead');
    await lead.request('PATCH', `/teams/${teamId}/rules/${env.id}`, { mode: 'enforce' });

    expect(await test('apps/api/.env.local')).toEqual({ decision: 'deny', ruleId: env.id, shadowIds: [] });
    expect(await test('pnpm build && npm publish')).toEqual({ decision: 'none', ruleId: null, shadowIds: [publish.id] });
    expect(await test('src/app.ts')).toEqual({ decision: 'none', ruleId: null, shadowIds: [] });
  });

  it('ignores rules that are turned off', async () => {
    const env = await ruleNamed('Never touch .env files');
    await lead.request('PATCH', `/teams/${teamId}/rules/${env.id}`, { mode: 'enforce', enabled: false });

    expect((await test('.env')).decision).toBe('none');
  });
});

describe('POST /teams/:teamId/rules/preview', () => {
  it("counts the team's recent tool calls a rule would catch, with redacted examples", async () => {
    await editFile('pnpm-lock.yaml');
    await editFile('apps/web/pnpm-lock.yaml');
    await editFile('apps/web/pnpm-lock.yaml');
    await editFile('src/app.ts');
    await runCommand('curl -u sk_live_51HxAbCdEfGhIjKl: https://api.stripe.com');

    const lockfiles = (await lead.request('POST', `/teams/${teamId}/rules/preview`, { tool: 'Edit', pattern: '**/pnpm-lock.yaml' })).json<RulePreview>();
    const curl = (await lead.request('POST', `/teams/${teamId}/rules/preview`, { tool: 'Bash', pattern: 'curl*' })).json<RulePreview>();

    expect(lockfiles.count).toBe(3);
    expect(lockfiles.examples.toSorted()).toEqual(['apps/web/pnpm-lock.yaml', 'pnpm-lock.yaml']);
    expect(curl.count).toBe(1);
    expect(curl.examples[0]).toContain('[REDACTED]');
    expect((await dev.request('POST', `/teams/${teamId}/rules/preview`, { tool: 'Edit', pattern: '*' })).statusCode).toBe(403);
  });
});
