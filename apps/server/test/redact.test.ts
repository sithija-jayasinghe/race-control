import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  displayPath,
  errorHeadline,
  hideHome,
  recordToolCall,
  redactSecrets,
  repoNameFromCwd,
} from '../src/lib/redact.ts';

const R = REDACTED;

describe('redactSecrets', () => {
  it.each([
    ['Race Control token', 'curl -H x rc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg', `curl -H x ${R}`],
    ['Anthropic key', 'ANTHROPIC_KEY sk-ant-api03-AbCdEfGhIjKlMnOpQrSt', `ANTHROPIC_KEY ${R}`],
    ['OpenAI project key', 'use sk-proj-AbCdEfGhIjKlMnOpQrSt please', `use ${R} please`],
    ['Stripe live key', 'stripe sk_live_51HxAbCdEfGhIjKl', `stripe ${R}`],
    ['GitHub token', 'git clone https://ghp_AbCdEfGhIjKlMnOpQrStUvWx0123@github.com/x', `git clone https://${R}@github.com/x`],
    ['GitHub fine-grained token', 'github_pat_11AbCdEfGh_IjKlMnOpQrStUv', R],
    ['AWS access key id', 'aws AKIAIOSFODNN7EXAMPLE', `aws ${R}`],
    ['Slack token', 'xoxb-1234567890-abcdefghij', R],
    ['Google API key', 'key AIzaSyA-AbCdEfGhIjKlMnOpQrStUvWxYz01234', `key ${R}`],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N', R],
    ['Bearer header', 'curl -H "Authorization: Bearer abc.def-ghi_123456"', `curl -H "Authorization: Bearer ${R}"`],
    ['URL credentials', 'psql postgres://admin:hunter2@db.internal:5432/app', `psql postgres://${R}@db.internal:5432/app`],
    ['env assignment', 'export DATABASE_PASSWORD=hunter2', `export DATABASE_PASSWORD=${R}`],
    ['quoted assignment', 'API_KEY="abc123def"', `API_KEY="${R}"`],
    ['yaml style', 'client_secret: abc123def', `client_secret: ${R}`],
    ['flag with value', 'mysql --password hunter2 -u root', `mysql --password ${R} -u root`],
    ['flag with equals', 'deploy --token=abc123def', `deploy --token=${R}`],
  ])('removes a %s', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('removes a whole private key block, even one cut off', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----';
    expect(redactSecrets(`cat <<EOF\n${key}\nEOF`)).toBe(`cat <<EOF\n${R}\nEOF`);
    expect(redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA')).toBe(R);
  });

  it.each([
    'pnpm test',
    'git push origin main',
    'cat src/auth/session.ts',
    'grep -r "token" src',
    'npm run build -- --token',
    'echo $API_TOKEN',
    'export GITHUB_TOKEN=$GITHUB_TOKEN',
    'git commit -m "fix auth redirect"',
  ])('leaves ordinary text alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('paths', () => {
  it('hides the home folder', () => {
    expect(hideHome('/Users/nimal/code/app/.env')).toBe('~/code/app/.env');
    expect(hideHome('/home/kasun/app')).toBe('~/app');
    expect(hideHome('C:\\Users\\amaya\\app\\x.ts')).toBe('~\\app\\x.ts');
    expect(hideHome('/srv/app/x.ts')).toBe('/srv/app/x.ts');
  });

  it('shows files relative to the session folder', () => {
    expect(displayPath('/Users/nimal/code/api/src/app.ts', '/Users/nimal/code/api')).toBe('src/app.ts');
    expect(displayPath('/Users/nimal/code/web/x.ts', '/Users/nimal/code/api')).toBe('~/code/web/x.ts');
    expect(displayPath('/Users/nimal/code/api-old/x.ts', '/Users/nimal/code/api')).toBe('~/code/api-old/x.ts');
  });

  it('names the repo after the session folder', () => {
    expect(repoNameFromCwd('/Users/nimal/code/buildflow-api')).toBe('buildflow-api');
    expect(repoNameFromCwd('/Users/nimal/code/buildflow-api/')).toBe('buildflow-api');
    expect(repoNameFromCwd(undefined)).toBeNull();
  });
});

describe('recordToolCall', () => {
  const cwd = '/Users/nimal/code/api';

  it('keeps an edit’s path but never its contents', () => {
    const record = recordToolCall(
      'Edit',
      { file_path: `${cwd}/src/auth/session.ts`, old_string: 'const secret = 1', new_string: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt', replace_all: false },
      cwd,
    );

    expect(record).toEqual({
      target: 'src/auth/session.ts',
      summary: 'edit src/auth/session.ts',
      input: { file_path: 'src/auth/session.ts', replace_all: false },
    });
  });

  it('never keeps what Write writes', () => {
    const record = recordToolCall('Write', { file_path: `${cwd}/.env`, content: 'DATABASE_URL=postgres://u:p@h/db' }, cwd);

    expect(record.target).toBe('.env');
    expect(JSON.stringify(record)).not.toContain('postgres');
  });

  it('keeps a redacted Bash command as the target', () => {
    const record = recordToolCall('Bash', { command: 'API_KEY=abc123def pnpm deploy', description: 'Deploy', timeout: 1000 }, cwd);

    expect(record.target).toBe(`API_KEY=${R} pnpm deploy`);
    expect(record.summary).toBe(`bash API_KEY=${R} pnpm deploy`);
    expect(record.input).toEqual({ command: `API_KEY=${R} pnpm deploy`, description: 'Deploy' });
  });

  it('truncates very long commands', () => {
    const record = recordToolCall('Bash', { command: `echo ${'x'.repeat(5000)}` }, cwd);

    expect(record.target!.length).toBeLessThanOrEqual(2001);
    expect(record.summary.length).toBeLessThanOrEqual(161);
  });

  it('keeps a fetched URL without its query string', () => {
    const record = recordToolCall('WebFetch', { url: 'https://api.example.com/v1/items?api_key=abc123&x=1#frag', prompt: 'summarise' }, cwd);

    expect(record.input).toEqual({ url: 'https://api.example.com/v1/items' });
    expect(JSON.stringify(record)).not.toContain('summarise');
  });

  it('keeps a subagent’s description but not its prompt', () => {
    const record = recordToolCall('Agent', { description: 'Find endpoints', prompt: 'Read everything in /secret', subagent_type: 'Explore' }, cwd);

    expect(record.input).toEqual({ description: 'Find endpoints', subagent_type: 'Explore' });
  });

  it('keeps only the name of MCP and unknown tools', () => {
    expect(recordToolCall('mcp__github__create_issue', { title: 'x', body: 'secret' }, cwd)).toEqual({
      target: null,
      summary: 'mcp__github__create_issue',
      input: {},
    });
  });

  it('relativises search paths', () => {
    expect(recordToolCall('Grep', { pattern: 'TODO', path: `${cwd}/src` }, cwd)).toMatchObject({
      target: 'src',
      summary: 'grep TODO in src',
    });
  });
});

describe('errorHeadline', () => {
  it('keeps only the first line, redacted', () => {
    expect(errorHeadline('Exit code 1\nError: connect to postgres://u:hunter2@db failed')).toBe('Exit code 1');
    expect(errorHeadline('token=abc123def rejected\nmore')).toBe(`token=${R} rejected`);
    expect(errorHeadline(undefined)).toBeUndefined();
  });
});
