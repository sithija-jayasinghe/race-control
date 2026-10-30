// pnpm simulate: replays a scripted race of five demo drivers through the real hook endpoint.
// See `pnpm simulate --help`.

import { parseArgs } from 'node:util';
import { createDb } from '../src/db/client.ts';
import { loadEnv } from '../src/env.ts';
import { LAP_MS } from '../src/simulator/scenario.ts';
import { httpSend, runRace } from '../src/simulator/run.ts';
import { SimulatorSetupError, resetDemo, revokeSimulatorTokens, setupDemoTeam } from '../src/simulator/setup.ts';

const HELP = `Usage: pnpm simulate [options]

Replays about ${Math.round(LAP_MS / 1000)} seconds of realistic Claude Code activity from five demo drivers
in a "Demo team", through the running server's hook endpoint.

Options:
  --viewer <email>  Add your Race Control account to the Demo team as a lead, to watch it
  --loop            Keep racing until you press Ctrl+C
  --speed <n>       Play faster, e.g. --speed 4
  --url <url>       Server to send to (default: PUBLIC_URL from .env)
  --reset           Delete the Demo team, its sessions and the demo users, then exit
  --help            Show this help
`;

const { values } = parseArgs({
  options: {
    viewer: { type: 'string' },
    loop: { type: 'boolean', default: false },
    speed: { type: 'string', default: '1' },
    url: { type: 'string' },
    reset: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('The simulator writes demo data and is for development only. Refusing to run in production.');
  process.exit(1);
}

const speed = Number(values.speed);
if (!Number.isFinite(speed) || speed <= 0 || speed > 100) {
  console.error('--speed must be a number between 0 and 100.');
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL);

if (values.reset) {
  const removed = await resetDemo(db);
  console.log(`Removed ${removed.teams} Demo team and ${removed.users} demo users.`);
  await close();
  process.exit(0);
}

const baseUrl = values.url ?? env.PUBLIC_URL;
try {
  const health = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
} catch {
  console.error(`Can't reach the server at ${baseUrl}. Start it first with: pnpm dev`);
  await close();
  process.exit(1);
}

let demo;
try {
  demo = await setupDemoTeam(db, { viewerEmail: values.viewer, now: new Date() });
} catch (error) {
  console.error(error instanceof SimulatorSetupError ? error.message : error);
  await close();
  process.exit(1);
}

console.log(`Demo team ready. Racing${values.loop ? ' until Ctrl+C' : ''} at speed ${speed}…`);
if (values.viewer) console.log(`${values.viewer} can watch it: switch to "Demo team" in the dashboard.`);

let stop = false;
process.on('SIGINT', () => {
  if (stop) process.exit(130);
  stop = true;
  console.log('\nStopping after the current event…');
});

const startedAt = Date.now();
const stats = await runRace({
  send: httpSend(baseUrl),
  tokens: demo.tokens,
  laps: values.loop ? Number.POSITIVE_INFINITY : 1,
  speed,
  log: (line) => console.log(`${String(Math.round((Date.now() - startedAt) / 1000)).padStart(4)}s  ${line}`),
  stopped: () => stop,
});

await revokeSimulatorTokens(db, demo.tokenIds, new Date());
await close();

console.log(
  `\n${stats.sent} events sent, ${stats.failed} failed. Hook latency: ${stats.p50Ms} ms typical, ${stats.p95Ms} ms at the 95th percentile.`,
);
console.log('The simulator tokens are revoked. Remove the demo data with: pnpm simulate --reset');
process.exit(stats.failed > 0 ? 1 : 0);
