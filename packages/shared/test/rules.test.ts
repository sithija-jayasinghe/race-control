import { describe, expect, it } from 'vitest';
import { alwaysAllowPattern } from '../src/rules.ts';

describe('alwaysAllowPattern', () => {
  it('allows exactly the file or the one command', () => {
    expect(alwaysAllowPattern({ toolName: 'Write', target: 'db/migrations/0042_users.sql' })).toBe('db/migrations/0042_users.sql');
    expect(alwaysAllowPattern({ toolName: 'Bash', target: 'npm publish --dry-run' })).toBe('npm publish --dry-run');
  });

  it('gives nothing it could not allow exactly', () => {
    for (const call of [
      { toolName: 'Write', target: null },
      { toolName: 'Bash', target: 'npm publish --token=[REDACTED]' },
      { toolName: 'Bash', target: 'npm publish && rm -rf dist' },
      { toolName: 'Bash', target: 'npm publish | tee log' },
      { toolName: 'Bash', target: 'rm build/*' },
      { toolName: 'Edit', target: 'src/what?.ts' },
      { toolName: 'Edit', target: `${'a/'.repeat(150)}x` },
    ]) {
      expect(alwaysAllowPattern(call)).toBeNull();
    }
  });
});
