import type { AgentSession, LiveEvent } from '@race-control/shared';
import type { FlagStatus } from '@/components/status-flag';
import type { Driver, Sector } from '@/components/timing-tower';

// Turns a team's sessions and recent events into what the Pit wall draws: folders as clusters,
// files as points, and each agent as a driver at the file it last touched (docs/design/UI.md).

/** Working sessions quiet for longer than this leave the track. */
export const ON_TRACK_MS = 2 * 60 * 60 * 1000;
/** Idle sessions (the agent finished responding) leave sooner, so old sessions don't crowd the tower. */
export const IDLE_ON_TRACK_MS = 10 * 60 * 1000;
/** Two agents on the same file within this window share a yellow flag. */
export const COLLISION_MS = 30 * 60 * 1000;
const MAX_CLUSTERS = 8;
const MAX_FILES_PER_CLUSTER = 10;
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit']);

export type TrackCluster = { id: string; label: string; fileIds: string[]; lastAt: number };
export type TrackFile = { id: string; clusterId: string; path: string; lastAt: number };
export type TrackDriver = Driver & {
  sessionId: string;
  repo: string | null;
  /** The file the agent last touched, if it's on the map. */
  fileId: string | null;
  clusterId: string | null;
  lastAction: string | null;
};
export type TrackModel = { clusters: TrackCluster[]; files: TrackFile[]; drivers: TrackDriver[] };

const at = (iso: string) => Date.parse(iso);

/** Three-letter driver codes from names, e.g. NIM. Duplicates become NI2, NI3. */
export function driverCodes(names: string[]): string[] {
  const taken = new Map<string, number>();
  return names.map((name) => {
    const letters = (name.split('@')[0] ?? '').replace(/[^a-z]/gi, '').toUpperCase().padEnd(3, 'X');
    const base = letters.slice(0, 3);
    const seen = taken.get(base) ?? 0;
    taken.set(base, seen + 1);
    return seen === 0 ? base : `${letters.slice(0, 2)}${seen + 1}`;
  });
}

function sectorFor(event: LiveEvent): Sector | null {
  if (event.decision === 'deny') return 'blocked';
  if (event.type === 'PostToolUseFailure') return 'failed';
  if (event.type !== 'PostToolUse') return null;
  return event.toolName === 'Bash' && /\btest\b/.test(event.summary ?? '') ? 'tests' : 'clean';
}

function statusFor(session: AgentSession, latest: LiveEvent | undefined): FlagStatus {
  if (latest?.decision === 'pending') return 'waiting';
  if (latest?.decision === 'deny') return 'blocked';
  return session.status === 'active' ? 'working' : 'idle';
}

export function buildTrackModel(sessions: AgentSession[], events: LiveEvent[], now = Date.now()): TrackModel {
  // Every working session is on track. A person's idle sessions collapse into their latest one,
  // shown only while they have nothing working, so finished sessions don't crowd the tower.
  const working = sessions.filter((s) => s.status === 'active' && now - at(s.lastEventAt) < ON_TRACK_MS);
  const busyPeople = new Set(working.map((s) => s.userId));
  const latestIdle = new Map<string, AgentSession>();
  for (const s of sessions) {
    if (s.status !== 'idle' || busyPeople.has(s.userId) || now - at(s.lastEventAt) >= IDLE_ON_TRACK_MS) continue;
    const kept = latestIdle.get(s.userId);
    if (!kept || at(s.lastEventAt) > at(kept.lastEventAt)) latestIdle.set(s.userId, s);
  }
  const onTrack = sessions.filter((s) => working.includes(s) || latestIdle.get(s.userId) === s);
  const sessionById = new Map(onTrack.map((s) => [s.id, s]));
  const eventsBySession = new Map<string, LiveEvent[]>();
  for (const event of events) {
    if (!sessionById.has(event.sessionId)) continue;
    const list = eventsBySession.get(event.sessionId) ?? [];
    list.push(event);
    eventsBySession.set(event.sessionId, list);
  }

  // Files and folders, from the file tools' targets (already relative to each repo).
  const files = new Map<string, TrackFile>();
  const clusters = new Map<string, TrackCluster>();
  const lastFileBySession = new Map<string, string>();
  for (const event of events) {
    const session = sessionById.get(event.sessionId);
    if (!session || !event.target || !event.toolName || !FILE_TOOLS.has(event.toolName)) continue;
    const repo = session.repoName ?? 'repo';
    const slash = event.target.indexOf('/');
    const folder = slash > 0 && !event.target.startsWith('~') ? event.target.slice(0, slash) : '';
    const clusterId = `${repo}/${folder}`;
    const fileId = `${repo}:${event.target}`;
    const when = at(event.createdAt);

    const cluster = clusters.get(clusterId) ?? { id: clusterId, label: folder ? `${repo}/${folder}` : repo, fileIds: [], lastAt: 0 };
    cluster.lastAt = Math.max(cluster.lastAt, when);
    if (!cluster.fileIds.includes(fileId)) cluster.fileIds.push(fileId);
    clusters.set(clusterId, cluster);
    files.set(fileId, { id: fileId, clusterId, path: event.target, lastAt: Math.max(files.get(fileId)?.lastAt ?? 0, when) });
    lastFileBySession.set(event.sessionId, fileId);
  }

  // Keep the busiest folders and their most recent files, so the map stays readable.
  const keptClusters = [...clusters.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_CLUSTERS);
  for (const cluster of keptClusters) {
    cluster.fileIds = cluster.fileIds
      .sort((a, b) => files.get(b)!.lastAt - files.get(a)!.lastAt)
      .slice(0, MAX_FILES_PER_CLUSTER);
  }
  const keptFileIds = new Set(keptClusters.flatMap((c) => c.fileIds));
  const keptFiles = [...files.values()].filter((f) => keptFileIds.has(f.id));

  const codes = driverCodes(onTrack.map((s) => s.userName ?? s.userEmail));
  const drivers: TrackDriver[] = onTrack.map((session, i) => {
    const own = eventsBySession.get(session.id) ?? [];
    const fileId = lastFileBySession.get(session.id);
    const sectors = own.map(sectorFor).filter((s): s is Sector => s !== null).slice(-3);
    return {
      id: session.id,
      sessionId: session.id,
      code: codes[i]!,
      name: session.userName ?? session.userEmail,
      agent: session.agent,
      status: statusFor(session, own.at(-1)),
      laps: session.toolCalls,
      sectors,
      repo: session.repoName,
      fileId: fileId && keptFileIds.has(fileId) ? fileId : null,
      clusterId: fileId && keptFileIds.has(fileId) ? (files.get(fileId)?.clusterId ?? null) : null,
      lastAction: session.lastAction,
    };
  });

  // Yellow flag: two working agents whose latest file is the same, both recently.
  for (const driver of drivers) {
    if (driver.status !== 'working' || !driver.fileId) continue;
    const touched = files.get(driver.fileId)!;
    const shared = drivers.some(
      (other) => other !== driver && other.fileId === driver.fileId && other.status !== 'idle' && now - touched.lastAt < COLLISION_MS,
    );
    if (shared) driver.status = 'yellow';
  }

  return { clusters: keptClusters, files: keptFiles, drivers };
}
