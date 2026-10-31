import type { IngestedHookEvent } from '@race-control/shared';

// A scripted race: five demo drivers doing realistic Claude Code work, with the moments the Pit wall
// is built to show. Times are milliseconds from the start at speed 1.

export type Driver = { code: string; name: string; email: string; repo: string };

export const DEMO_DOMAIN = 'demo.racecontrol.test';
export const DEMO_TEAM_NAME = 'Demo team';
export const DEMO_LEAD = { name: 'Demo lead', email: `lead@${DEMO_DOMAIN}` };

export const DRIVERS: Driver[] = [
  { code: 'NIM', name: 'Nimal', email: `nimal@${DEMO_DOMAIN}`, repo: 'buildflow-api' },
  { code: 'KAS', name: 'Kasun', email: `kasun@${DEMO_DOMAIN}`, repo: 'buildflow-api' },
  { code: 'AMA', name: 'Amaya', email: `amaya@${DEMO_DOMAIN}`, repo: 'buildflow-api' },
  { code: 'RUW', name: 'Ruwan', email: `ruwan@${DEMO_DOMAIN}`, repo: 'buildflow-web' },
  { code: 'JAN', name: 'Janith', email: `janith@${DEMO_DOMAIN}`, repo: 'buildflow-api' },
];

export type Step = {
  at: number;
  driver: string;
  event: IngestedHookEvent;
  body: Record<string, unknown>;
};

type Tool = { tool: string; input: Record<string, unknown>; fails?: string };

/** A tool call is a PreToolUse, then a PostToolUse (or PostToolUseFailure) `took` ms later. */
function call(driver: string, at: number, { tool, input, fails }: Tool, took = 900): Step[] {
  const toolUseId = `toolu_${driver}_${at}`;
  const common = { tool_name: tool, tool_input: input, tool_use_id: toolUseId };
  return [
    { at, driver, event: 'PreToolUse', body: common },
    fails
      ? { at: at + took, driver, event: 'PostToolUseFailure', body: { ...common, error: fails, is_interrupt: false } }
      : { at: at + took, driver, event: 'PostToolUse', body: { ...common, tool_response: { ok: true } } },
  ];
}

const start = (driver: string, at: number): Step => ({ at, driver, event: 'SessionStart', body: { source: 'startup' } });
const stop = (driver: string, at: number): Step => ({
  at,
  driver,
  event: 'Stop',
  body: { stop_hook_active: false, last_assistant_message: 'Done. Here is a summary of the changes.' },
});
const end = (driver: string, at: number): Step => ({ at, driver, event: 'SessionEnd', body: { reason: 'prompt_input_exit' } });

const read = (file_path: string): Tool => ({ tool: 'Read', input: { file_path } });
const edit = (file_path: string): Tool => ({
  tool: 'Edit',
  input: { file_path, old_string: 'const timeout = 30;', new_string: 'const timeout = 60;' },
});
const bash = (command: string, fails?: string): Tool => ({ tool: 'Bash', input: { command, description: command }, ...(fails ? { fails } : {}) });

/** Paths are relative to the driver's repo folder; `steps()` makes them absolute like Claude Code does. */
const SCRIPT: Step[] = [
  // Nimal refactors token refresh in the API.
  start('NIM', 0),
  ...call('NIM', 1500, read('src/auth/session.ts')),
  ...call('NIM', 4000, { tool: 'Grep', input: { pattern: 'refreshToken', path: 'src' } }),
  ...call('NIM', 9000, edit('src/auth/session.ts'), 1200),
  ...call('NIM', 16000, bash('pnpm test -- auth'), 4000),
  ...call('NIM', 26000, edit('src/auth/refresh.ts')),
  stop('NIM', 34000),

  // Kasun works in the same file a few seconds later: a collision for the yellow flag, and Team Radio
  // tells Kasun's agent about Nimal's edit when it reads the file.
  start('KAS', 2500),
  ...call('KAS', 10500, read('src/auth/session.ts')),
  ...call('KAS', 13000, edit('src/auth/session.ts'), 1500),
  ...call('KAS', 20000, bash('pnpm lint'), 2500),
  stop('KAS', 30000),

  // Amaya edits a migration: the kind of change leads approve (Week 4).
  start('AMA', 5000),
  ...call('AMA', 8000, read('db/schema.ts')),
  ...call('AMA', 14000, { tool: 'Write', input: { file_path: 'db/migrations/0042_users.sql', content: 'ALTER TABLE users ADD COLUMN plan text;' } }),
  ...call('AMA', 22000, bash('pnpm db:migrate'), 3000),
  stop('AMA', 40000),

  // Ruwan's test fails, then passes after a fix.
  start('RUW', 1000),
  ...call('RUW', 3500, read('src/pages/pit-wall.tsx')),
  ...call('RUW', 10000, edit('src/pages/pit-wall.tsx')),
  ...call('RUW', 15000, bash('pnpm test', 'Exit code 1\nFAIL test/pit-wall.test.tsx > shows cars on track'), 5000),
  ...call('RUW', 24000, edit('src/pages/pit-wall.tsx')),
  ...call('RUW', 29000, bash('pnpm test'), 5000),
  stop('RUW', 38000),

  // Janith touches .env (blocked by a rule in Week 4) and runs a command with a key in it (redacted).
  start('JAN', 7000),
  ...call('JAN', 12000, edit('.env')),
  ...call('JAN', 18000, bash('curl -H "Authorization: Bearer sk_live_51HxDemoKeyAbCdEfGh" https://api.stripe.com/v1/charges'), 1500),
  ...call('JAN', 27000, { tool: 'WebFetch', input: { url: 'https://docs.stripe.com/api?key=abc123', prompt: 'Find the charges API' } }),
  stop('JAN', 33000),
  end('JAN', 42000),
];

/** How long one lap takes at speed 1. */
export const LAP_MS = Math.max(...SCRIPT.map((s) => s.at)) + 3000;

const ABSOLUTE_PATH_KEYS = ['file_path', 'path'];

/**
 * The race for one lap, sorted by time. Each run and lap gets fresh session ids, like a new Claude Code
 * session, and paths become absolute under each driver's demo folder, the way Claude Code sends them.
 */
export function steps(lap: number, runId = 'run'): Array<Step & { sessionId: string; cwd: string }> {
  return SCRIPT.map((step) => {
    const driver = DRIVERS.find((d) => d.code === step.driver)!;
    const cwd = `/Users/${driver.name.toLowerCase()}/code/${driver.repo}`;
    const body = { ...step.body };
    if (body.tool_input && typeof body.tool_input === 'object') {
      const input = { ...(body.tool_input as Record<string, unknown>) };
      for (const key of ABSOLUTE_PATH_KEYS) {
        const value = input[key];
        if (typeof value === 'string') input[key] = `${cwd}/${value}`;
      }
      body.tool_input = input;
    }
    return { ...step, body, sessionId: `demo-${driver.code.toLowerCase()}-${runId}-lap${lap}`, cwd };
  }).sort((a, b) => a.at - b.at);
}
