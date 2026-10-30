import { describe, expect, it } from 'vitest';
import { COLLISION_MS, IDLE_ON_TRACK_MS, ON_TRACK_MS, buildTrackModel, driverCodes } from '../src/lib/track-model.ts';
import { TEAMMATE, agentSession, liveEvent } from './helpers.tsx';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('driverCodes', () => {
  it('makes three-letter codes from names or emails, and keeps them unique', () => {
    expect(driverCodes(['Nimal', 'kasun@example.test', 'Nimesh', 'Al', 'Nina'])).toEqual(['NIM', 'KAS', 'NI2', 'ALX', 'NIN']);
  });
});

describe('buildTrackModel', () => {
  it('puts working and recently idle sessions on track, and leaves ended or long-quiet ones off', () => {
    const working = agentSession({ status: 'active', lastEventAt: ago(1000), userName: 'Nimal', toolCalls: 7 });
    const idle = agentSession({ status: 'idle', lastEventAt: ago(60_000), userName: 'Kasun', userId: TEAMMATE.id });
    const ended = agentSession({ status: 'ended', lastEventAt: ago(1000) });
    const quiet = agentSession({ status: 'active', lastEventAt: ago(ON_TRACK_MS + 1) });
    const longIdle = agentSession({ status: 'idle', lastEventAt: ago(IDLE_ON_TRACK_MS + 1), userId: '99999999-9999-4999-8999-999999999999' });

    const model = buildTrackModel([working, idle, ended, quiet, longIdle], [], NOW);

    expect(model.drivers.map((d) => [d.code, d.status, d.laps])).toEqual([
      ['NIM', 'working', 7],
      ['KAS', 'idle', 0],
    ]);
  });

  it("collapses a person's idle sessions into their latest, and hides them while they have one working", () => {
    const olderIdle = agentSession({ status: 'idle', lastEventAt: ago(120_000), userName: 'Kasun', userId: TEAMMATE.id });
    const newerIdle = agentSession({ status: 'idle', lastEventAt: ago(60_000), userName: 'Kasun', userId: TEAMMATE.id });
    const myIdle = agentSession({ status: 'idle', lastEventAt: ago(60_000), userName: 'Nimal' });
    const myWorking = agentSession({ status: 'active', lastEventAt: ago(1000), userName: 'Nimal' });
    const myOtherWorking = agentSession({ status: 'active', lastEventAt: ago(2000), userName: 'Nimal' });

    const model = buildTrackModel([olderIdle, newerIdle, myIdle, myWorking, myOtherWorking], [], NOW);

    expect(model.drivers.map((d) => d.sessionId).sort()).toEqual([newerIdle.id, myWorking.id, myOtherWorking.id].sort());
  });

  it('groups files into folders per repo, and places each driver at the file it last touched', () => {
    const s = agentSession({ repoName: 'api', lastEventAt: ago(1000) });
    const events = [
      liveEvent({ sessionId: s.id, toolName: 'Read', target: 'src/auth/session.ts', createdAt: ago(5000) }),
      liveEvent({ sessionId: s.id, toolName: 'Edit', target: 'src/app.ts', createdAt: ago(3000) }),
      liveEvent({ sessionId: s.id, toolName: 'Edit', target: 'README.md', createdAt: ago(2000) }),
      liveEvent({ sessionId: s.id, toolName: 'Bash', target: 'pnpm test', createdAt: ago(1000) }),
    ];

    const model = buildTrackModel([s], events, NOW);

    expect(model.clusters.map((c) => c.label).sort()).toEqual(['api', 'api/src']);
    expect(model.files.map((f) => f.path).sort()).toEqual(['README.md', 'src/app.ts', 'src/auth/session.ts']);
    expect(model.drivers[0]!.fileId).toBe('api:README.md');
  });

  it('shows a yellow flag when two working agents are on the same file', () => {
    const a = agentSession({ repoName: 'api', userName: 'Nimal', lastEventAt: ago(1000) });
    const b = agentSession({ repoName: 'api', userName: 'Kasun', userId: TEAMMATE.id, lastEventAt: ago(1000) });
    const c = agentSession({ repoName: 'api', userName: 'Ruwan', lastEventAt: ago(1000) });
    const events = [
      liveEvent({ sessionId: a.id, toolName: 'Edit', target: 'src/auth/session.ts', createdAt: ago(4000) }),
      liveEvent({ sessionId: b.id, toolName: 'Edit', target: 'src/auth/session.ts', createdAt: ago(2000) }),
      liveEvent({ sessionId: c.id, toolName: 'Edit', target: 'src/other.ts', createdAt: ago(2000) }),
    ];

    const model = buildTrackModel([a, b, c], events, NOW);

    expect(model.drivers.map((d) => [d.code, d.status])).toEqual([
      ['NIM', 'yellow'],
      ['KAS', 'yellow'],
      ['RUW', 'working'],
    ]);
  });

  it('drops the yellow flag once the shared file has been quiet for 30 minutes', () => {
    const a = agentSession({ repoName: 'api', lastEventAt: ago(1000) });
    const b = agentSession({ repoName: 'api', lastEventAt: ago(1000) });
    const events = [
      liveEvent({ sessionId: a.id, toolName: 'Edit', target: 'x.ts', createdAt: ago(COLLISION_MS + 5000) }),
      liveEvent({ sessionId: b.id, toolName: 'Edit', target: 'x.ts', createdAt: ago(COLLISION_MS + 1000) }),
    ];

    expect(buildTrackModel([a, b], events, NOW).drivers.every((d) => d.status === 'working')).toBe(true);
  });

  it('colours sectors from the last three outcomes', () => {
    const s = agentSession({ lastEventAt: ago(1000) });
    const events = [
      liveEvent({ sessionId: s.id, type: 'PostToolUse', toolName: 'Edit', summary: 'edit a.ts' }),
      liveEvent({ sessionId: s.id, type: 'PostToolUse', toolName: 'Bash', summary: 'bash pnpm test' }),
      liveEvent({ sessionId: s.id, type: 'PreToolUse', toolName: 'Bash', summary: 'bash pnpm build' }),
      liveEvent({ sessionId: s.id, type: 'PostToolUseFailure', toolName: 'Bash', summary: 'bash pnpm build · failed' }),
      liveEvent({ sessionId: s.id, type: 'PostToolUse', toolName: 'Read', summary: 'read b.ts' }),
    ];

    expect(buildTrackModel([s], events, NOW).drivers[0]!.sectors).toEqual(['tests', 'failed', 'clean']);
  });

  it('shows waiting and blocked from the latest decision (Week 4 guardrails)', () => {
    const waiting = agentSession({ lastEventAt: ago(1000) });
    const blocked = agentSession({ lastEventAt: ago(1000) });
    const events = [
      liveEvent({ sessionId: waiting.id, decision: 'pending' }),
      liveEvent({ sessionId: blocked.id, decision: 'deny' }),
    ];

    expect(buildTrackModel([waiting, blocked], events, NOW).drivers.map((d) => d.status)).toEqual(['waiting', 'blocked']);
  });

  it('keeps the map readable: at most 8 folders and 10 files each', () => {
    const s = agentSession({ repoName: 'api', lastEventAt: ago(1000) });
    const events = Array.from({ length: 12 }, (_, folder) =>
      Array.from({ length: 14 }, (_, file) =>
        liveEvent({ sessionId: s.id, toolName: 'Read', target: `dir${folder}/file${file}.ts`, createdAt: ago(100_000 - folder * 100 - file) }),
      ),
    ).flat();

    const model = buildTrackModel([s], events, NOW);

    expect(model.clusters).toHaveLength(8);
    expect(Math.max(...model.clusters.map((c) => c.fileIds.length))).toBe(10);
  });
});
