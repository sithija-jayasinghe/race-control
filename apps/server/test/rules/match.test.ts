import { STARTER_RULES } from '@race-control/shared';
import { describe, expect, it } from 'vitest';
import { commandParts, evaluateRules, ruleMatches, wildcardMatch, type MatchableRule } from '../../src/modules/rules/match.ts';

let nextId = 0;
function rule(overrides: Partial<MatchableRule> = {}): MatchableRule {
  nextId++;
  return {
    id: `rule-${nextId}`,
    name: `Rule ${nextId}`,
    tool: '*',
    pattern: '*',
    action: 'block',
    mode: 'enforce',
    enabled: true,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, nextId)),
    ...overrides,
  };
}

const edit = (target: string, toolName = 'Edit') => ({ toolName, target, command: null });
const bash = (command: string) => ({ toolName: 'Bash', target: command, command });
const starter = (name: string) => rule({ ...STARTER_RULES.find((r) => r.name === name)! });

describe('wildcardMatch for paths', () => {
  it.each([
    ['**/.env*', '.env', true],
    ['**/.env*', '.env.local', true],
    ['**/.env*', 'apps/server/.env', true],
    ['**/.env*', 'src/env.ts', false],
    ['**/migrations/**', 'db/migrations/0042_users.sql', true],
    ['**/migrations/**', 'migrations/0001.sql', true],
    ['**/migrations/**', 'db/migrations.ts', false],
    ['src/*.ts', 'src/app.ts', true],
    ['src/*.ts', 'src/auth/session.ts', false],
    ['src/**/*.ts', 'src/app.ts', true],
    ['src/**/*.ts', 'src/auth/deep/session.ts', true],
    ['src/**', 'src/a/b', true],
    ['src/**', 'lib/src/a', false],
    ['file?.txt', 'file1.txt', true],
    ['file?.txt', 'file/.txt', false],
    ['package.json', 'package.json', true],
    ['package.json', 'apps/web/package.json', false],
    ['*', 'README.md', true],
    ['*', 'docs/README.md', false],
  ])('%s against %s is %s', (pattern, text, expected) => {
    expect(wildcardMatch(pattern, text, true)).toBe(expected);
  });

  it('treats every other character literally, including regex syntax', () => {
    expect(wildcardMatch('a.b', 'axb', true)).toBe(false);
    expect(wildcardMatch('(x)+[y]', '(x)+[y]', true)).toBe(true);
    expect(wildcardMatch('^$', '^$', true)).toBe(true);
  });

  it('stays fast on patterns that make regular expressions backtrack', () => {
    const started = performance.now();
    expect(wildcardMatch('*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(10_000), false)).toBe(false);
    expect(wildcardMatch('**/**/**/**/**/x', `${'a/'.repeat(3000)}y`, true)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('wildcardMatch for commands', () => {
  it('lets * cross slashes and spaces', () => {
    expect(wildcardMatch('git push*-f*main*', 'git push --force origin main', false)).toBe(true);
    expect(wildcardMatch('git push*-f*main*', 'git push -f origin main', false)).toBe(true);
    expect(wildcardMatch('git push*-f*main*', 'git push origin main', false)).toBe(false);
    expect(wildcardMatch('curl */admin*', 'curl https://x.test/admin/users', false)).toBe(true);
  });
});

describe('commandParts', () => {
  it('splits chains, pipes and lines into separate commands', () => {
    expect(commandParts('cd app && npm publish; echo done | tee log\nls || true')).toEqual([
      'cd app',
      'npm publish',
      'echo done',
      'tee log',
      'ls',
      'true',
    ]);
  });
});

describe('ruleMatches', () => {
  it('matches the tool by name, a | list, or *', () => {
    expect(ruleMatches(rule({ tool: 'Edit', pattern: 'a.ts' }), edit('a.ts'))).toBe(true);
    expect(ruleMatches(rule({ tool: 'Edit', pattern: 'a.ts' }), edit('a.ts', 'Write'))).toBe(false);
    expect(ruleMatches(rule({ tool: 'Edit | Write', pattern: 'a.ts' }), edit('a.ts', 'Write'))).toBe(true);
    expect(ruleMatches(rule({ tool: '*', pattern: 'a.ts' }), edit('a.ts', 'Read'))).toBe(true);
    expect(ruleMatches(rule({ tool: 'edit', pattern: 'a.ts' }), edit('a.ts'))).toBe(false);
  });

  it('matches Bash on each command in a chain, as a whole', () => {
    const publish = starter('Publishing needs a lead');
    expect(ruleMatches(publish, bash('npm publish --access public'))).toBe(true);
    expect(ruleMatches(publish, bash('pnpm build && npm publish'))).toBe(true);
    expect(ruleMatches(publish, bash('echo "run npm publish later"'))).toBe(false);
  });

  it('normalises paths, so .. and ./ cannot hide a file', () => {
    const env = starter('Never touch .env files');
    expect(ruleMatches(env, edit('src/../.env'))).toBe(true);
    expect(ruleMatches(env, edit('./config/./.env'))).toBe(true);
  });

  it('never matches when disabled, or without a path or command', () => {
    expect(ruleMatches(rule({ enabled: false }), edit('a.ts'))).toBe(false);
    expect(ruleMatches(rule(), { toolName: 'Edit', target: null, command: null })).toBe(false);
    expect(ruleMatches(rule({ tool: 'Bash' }), { toolName: 'Bash', target: null, command: null })).toBe(false);
  });

  it('catches what each starter rule is for, and not its near misses', () => {
    expect(ruleMatches(starter('Never touch .env files'), edit('apps/api/.env.production', 'MultiEdit'))).toBe(true);
    expect(ruleMatches(starter('Never touch .env files'), edit('.env', 'Read'))).toBe(false);
    expect(ruleMatches(starter('No rm -rf /'), bash('sudo true; rm -rf /'))).toBe(true);
    expect(ruleMatches(starter('No rm -rf /'), bash('rm -rf /tmp/build'))).toBe(false);
    expect(ruleMatches(starter('No force push to main'), bash('git push --force origin main'))).toBe(true);
    expect(ruleMatches(starter('No force push to main'), bash('git push origin feature'))).toBe(false);
    expect(ruleMatches(starter('Migrations need a lead'), edit('db/migrations/0042.sql', 'Write'))).toBe(true);
  });
});

describe('evaluateRules', () => {
  it('records matching shadow rules and lets the first enforced one decide', () => {
    const shadow = rule({ mode: 'shadow' });
    const older = rule({ action: 'approve' });
    const newer = rule({ action: 'approve' });

    expect(evaluateRules([newer, shadow, older], edit('a.ts'))).toEqual({ shadow: [shadow], enforced: older });
  });

  it('lets a block win over an older approval', () => {
    const approve = rule({ action: 'approve' });
    const block = rule({ action: 'block' });

    expect(evaluateRules([approve, block], edit('a.ts')).enforced).toBe(block);
  });

  it('decides nothing when only shadow rules, or no rules, match', () => {
    expect(evaluateRules([rule({ mode: 'shadow' })], edit('a.ts')).enforced).toBeUndefined();
    expect(evaluateRules([rule({ pattern: 'b.ts' })], edit('a.ts'))).toEqual({ shadow: [], enforced: undefined });
  });
});
