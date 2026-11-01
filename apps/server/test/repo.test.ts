import { describe, expect, it } from 'vitest';
import { eventRepo, isInside, repoFromHeaders, repoFromRemote, repoNameFromKey } from '../src/lib/repo.ts';

describe('repoFromRemote', () => {
  it('gives every form of the same remote the same key', () => {
    const forms = [
      'git@github.com:Org/BuildFlow-API.git',
      'https://github.com/org/buildflow-api',
      'https://github.com/org/buildflow-api.git/',
      'ssh://git@github.com:22/org/buildflow-api.git',
      'https://nimal:ghp_secret123@github.com/org/buildflow-api.git',
      'git://github.com/org/buildflow-api',
    ];

    expect(new Set(forms.map((f) => repoFromRemote(f)?.key))).toEqual(new Set(['github.com/org/buildflow-api']));
    expect(repoFromRemote(forms[0])?.name).toBe('BuildFlow-API');
  });

  it('never returns credentials', () => {
    expect(JSON.stringify(repoFromRemote('https://x-access-token:ghs_abc123@github.com/org/api.git'))).not.toContain('ghs_abc123');
  });

  it('keeps nested groups apart from their parents', () => {
    expect(repoFromRemote('git@gitlab.com:group/sub/api.git')).toEqual({ key: 'gitlab.com/group/sub/api', name: 'api' });
  });

  it('gives nothing for local paths, odd characters or no remote', () => {
    for (const remote of [undefined, '', '/srv/git/api.git', 'file:///srv/git/api.git', 'C:\\repos\\api', 'C:/repos/api', 'https://github.com/org/a b']) {
      expect(repoFromRemote(remote)).toBeNull();
    }
  });
});

describe('isInside', () => {
  it('compares folders, not text prefixes', () => {
    expect(isInside('/Users/nimal/code/api/apps/web', '~/code/api')).toBe(true);
    expect(isInside('/Users/nimal/code/api', '~/code/api/')).toBe(true);
    expect(isInside('/Users/nimal/code/api-old', '~/code/api')).toBe(false);
  });
});

describe('repoFromHeaders', () => {
  it('uses the remote and the top folder, with the home folder hidden', () => {
    expect(repoFromHeaders('/Users/nimal/code/api', 'git@github.com:org/api.git', '/Users/nimal/code/api/apps/web')).toEqual({
      key: 'github.com/org/api',
      name: 'api',
      root: '~/code/api',
    });
  });

  it('falls back to the top folder name without a remote', () => {
    expect(repoFromHeaders('/home/kasun/work/api', '', '/home/kasun/work/api')).toEqual({ key: 'local:api', name: 'api', root: '~/work/api' });
  });

  it('ignores a top folder the agent is not in', () => {
    expect(repoFromHeaders('/Users/nimal/code/other', 'git@github.com:org/other.git', '/Users/nimal/code/api')).toBeNull();
    expect(repoFromHeaders('', 'git@github.com:org/api.git', '/Users/nimal/code/api')).toBeNull();
  });
});

describe('eventRepo', () => {
  const session = { key: 'github.com/org/api', name: 'api', root: '~/code/api' };

  it("uses the session's repo while the agent is inside it, otherwise the folder name", () => {
    expect(eventRepo(session, '/Users/nimal/code/api/apps/web')).toBe(session);
    expect(eventRepo(session, '/Users/nimal/code/web')).toEqual({ key: 'local:web', name: 'web', root: null });
    expect(eventRepo(null, '/Users/nimal/code/api')).toEqual({ key: 'local:api', name: 'api', root: null });
  });
});

describe('repoNameFromKey', () => {
  it('names a repo from its key', () => {
    expect(repoNameFromKey('github.com/org/api')).toBe('api');
    expect(repoNameFromKey('local:api')).toBe('api');
  });
});
