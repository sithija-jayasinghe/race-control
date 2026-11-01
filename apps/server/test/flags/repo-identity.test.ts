import type { SessionTimeline, YellowFlag } from '@race-control/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { addMember, createTeamAs, createTestApp, signInAs, type SignedInUser, type TestApp } from '../helpers/app.ts';

// Which repo an agent is in comes from the session hook's git headers (SPEC section 4), so two clones of
// one repo match whatever their folders are called.

let t: TestApp;
let lead: SignedInUser;
let teamId: string;
let nimal: string;
let kasun: string;

const tokenFor = async (user: SignedInUser, team = teamId) =>
  (await user.request('POST', `/teams/${team}/tokens`, { label: 'laptop' })).json<{ token: string }>().token;

function hook(token: string, event: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return t.app.inject({
    method: 'POST',
    url: `/hooks/${event}`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    payload: { hook_event_name: event, ...body },
  });
}

/** The session hook from the snippet: where git says the repo is. */
const start = (token: string, session: string, cwd: string, root?: string, remote?: string) =>
  hook(token, 'SessionStart', { session_id: session, cwd, source: 'startup' }, {
    ...(root === undefined ? {} : { 'x-race-control-repo-root': root }),
    ...(remote === undefined ? {} : { 'x-race-control-repo-remote': remote }),
  });

const edit = (token: string, session: string, cwd: string, file: string) =>
  hook(token, 'PreToolUse', { session_id: session, cwd, tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' } });

const flags = async () => (await lead.request('GET', `/teams/${teamId}/flags`)).json<YellowFlag[]>();

beforeEach(async () => {
  t = await createTestApp();
  lead = await signInAs(t, 'lead@example.test');
  const dev = await signInAs(t, 'kasun@example.test');
  teamId = await createTeamAs(lead, 'BuildFlow');
  await addMember(lead, teamId, dev, 'developer');
  nimal = await tokenFor(lead);
  kasun = await tokenFor(dev);
});

afterEach(async () => {
  await t.close();
});

describe('matching repos by their git remote', () => {
  it('flags two clones of one repo in differently named folders', async () => {
    await start(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api', 'git@github.com:org/buildflow-api.git');
    await start(kasun, 'k', '/home/kasun/work/buildflow-api', '/home/kasun/work/buildflow-api', 'https://github.com/org/buildflow-api');
    await edit(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api/src/auth/session.ts');

    const reply = await edit(kasun, 'k', '/home/kasun/work/buildflow-api', '/home/kasun/work/buildflow-api/src/auth/session.ts');

    expect(await flags()).toMatchObject([{ id: 'github.com/org/buildflow-api:src/auth/session.ts', repoName: 'buildflow-api' }]);
    expect(reply.json<{ hookSpecificOutput: { additionalContext: string } }>().hookSpecificOutput.additionalContext).toContain('src/auth/session.ts');
  });

  it('keeps apart two different repos that share a folder name', async () => {
    await start(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api', 'git@github.com:org/billing-api.git');
    await start(kasun, 'k', '/home/kasun/code/api', '/home/kasun/code/api', 'git@github.com:org/search-api.git');
    await edit(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api/src/app.ts');

    const reply = await edit(kasun, 'k', '/home/kasun/code/api', '/home/kasun/code/api/src/app.ts');

    expect(await flags()).toEqual([]);
    expect(reply.body).toBe('');
  });

  it('stores paths from the top of the repo when the agent started in a subfolder', async () => {
    await start(nimal, 'n', '/Users/nimal/code/api/apps/web', '/Users/nimal/code/api', 'git@github.com:org/api.git');
    await start(kasun, 'k', '/home/kasun/api', '/home/kasun/api', 'git@github.com:org/api.git');
    await edit(nimal, 'n', '/Users/nimal/code/api/apps/web', '/Users/nimal/code/api/apps/web/src/x.ts');
    await edit(kasun, 'k', '/home/kasun/api', '/home/kasun/api/apps/web/src/x.ts');

    expect(await flags()).toMatchObject([{ target: 'apps/web/src/x.ts', repoName: 'api' }]);
  });

  it('follows an agent into another repo', async () => {
    await start(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api', 'git@github.com:org/api.git');
    await hook(nimal, 'CwdChanged', { session_id: 'n', cwd: '/Users/nimal/code/api', old_cwd: '/Users/nimal/code/api', new_cwd: '/Users/nimal/code/web' }, {
      'x-race-control-repo-root': '/Users/nimal/code/web',
      'x-race-control-repo-remote': 'git@github.com:org/web.git',
    });
    await edit(nimal, 'n', '/Users/nimal/code/web', '/Users/nimal/code/web/src/page.tsx');
    await start(kasun, 'k', '/home/kasun/frontend', '/home/kasun/frontend', 'git@github.com:org/web.git');
    await edit(kasun, 'k', '/home/kasun/frontend', '/home/kasun/frontend/src/page.tsx');

    expect(await flags()).toMatchObject([{ id: 'github.com/org/web:src/page.tsx', repoName: 'web' }]);
    // Changing folder isn't a step on the timeline.
    const [session] = await t.db.select().from(schema.sessions).where(eq(schema.sessions.agentSessionId, 'n'));
    expect(session).toMatchObject({ repoKey: 'github.com/org/web', repoName: 'web', repoRoot: '~/code/web' });
    const timeline = (await lead.request('GET', `/teams/${teamId}/sessions/${session!.id}`)).json<SessionTimeline>();
    expect(timeline.events.map((e) => e.type)).toEqual(['SessionStart', 'PreToolUse']);
  });

  it('falls back to the folder name for an agent with the old snippet', async () => {
    await hook(nimal, 'SessionStart', { session_id: 'n', cwd: '/Users/nimal/code/api' });
    await edit(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api/src/app.ts');
    await edit(kasun, 'k', '/home/kasun/code/api', '/home/kasun/code/api/src/app.ts');

    expect(await flags()).toMatchObject([{ id: 'local:api:src/app.ts', repoName: 'api' }]);
  });

  it('ignores repo headers for a folder the agent is not in', async () => {
    await start(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/elsewhere', 'git@github.com:org/elsewhere.git');

    const [session] = await t.db.select().from(schema.sessions).where(eq(schema.sessions.agentSessionId, 'n'));
    expect(session).toMatchObject({ repoKey: 'local:api', repoName: 'api', repoRoot: null });
  });

  it('never stores credentials or the home folder from the headers', async () => {
    await start(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api', 'https://nimal:ghp_secret123@github.com/org/api.git');
    await edit(nimal, 'n', '/Users/nimal/code/api', '/Users/nimal/code/api/src/app.ts');

    const stored = JSON.stringify([await t.db.select().from(schema.sessions), await t.db.select().from(schema.events)]);
    expect(stored).not.toContain('ghp_secret123');
    expect(stored).not.toContain('/Users/nimal');
  });

  it("never matches another team's clone of the same repo", async () => {
    const outsider = await signInAs(t, 'outsider@example.test');
    const otherTeam = await createTeamAs(outsider, 'Other');
    const theirs = await tokenFor(outsider, otherTeam);
    await start(theirs, 'o', '/Users/o/api', '/Users/o/api', 'git@github.com:org/api.git');
    await edit(theirs, 'o', '/Users/o/api', '/Users/o/api/src/app.ts');
    await start(nimal, 'n', '/Users/nimal/api', '/Users/nimal/api', 'git@github.com:org/api.git');

    const reply = await edit(nimal, 'n', '/Users/nimal/api', '/Users/nimal/api/src/app.ts');

    expect(reply.body).toBe('');
    expect(await flags()).toEqual([]);
  });
});
