import type { AgentSession, LiveEvent, YellowFlag } from '@race-control/shared';
import { Check, Lock } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { LightsOut } from '@/components/lights-out';
import { LiveBadge } from '@/components/live-badge';
import { LiveClock } from '@/components/live-clock';
import { Panel } from '@/components/panel';
import { RaceControlBanner } from '@/components/race-control-banner';
import { StatusFlag, type FlagStatus } from '@/components/status-flag';
import { TeamRadioCard } from '@/components/team-radio-card';
import { TimingTower, type Driver } from '@/components/timing-tower';
import { TrackMap } from '@/components/track-map';
import { activeFlags, overlapKey, useFlags } from '@/lib/flags';
import { useSessions, useTeamEvents } from '@/lib/sessions';
import { buildTrackModel, driverCodes, type TrackDriver, type TrackModel } from '@/lib/track-model';
import { timeAgo } from '@/lib/time';
import { useTokens } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useTeamContext } from '@/routes';

// The demo race: made-up drivers so people can see what the Pit wall does before connecting an agent.
// Live agents replace it once the hook endpoints arrive (Week 2).
const DEMO_DRIVERS: Driver[] = [
  { id: '1', code: 'NIM', name: 'Nimal', agent: 'claude_code', status: 'yellow', laps: 44, sectors: ['clean', 'tests', 'yellow'] },
  { id: '2', code: 'KAS', name: 'Kasun', agent: 'claude_code', status: 'yellow', laps: 42, sectors: ['clean', 'clean', 'yellow'] },
  { id: '3', code: 'AMA', name: 'Amaya', agent: 'codex', status: 'waiting', laps: 37, sectors: ['tests', 'clean', 'clean'] },
  { id: '4', code: 'RUW', name: 'Ruwan', agent: 'claude_code', status: 'working', laps: 36, sectors: ['clean', 'tests', 'clean'] },
  { id: '5', code: 'JAN', name: 'Janith', agent: 'claude_code', status: 'blocked', laps: 30, sectors: ['clean', 'clean', 'blocked'] },
];
const DEMO_START = new Date(Date.now() - (2 * 3600 + 14 * 60) * 1000);

function countByStatus(drivers: Driver[]) {
  const counts: Partial<Record<FlagStatus, number>> = {};
  for (const d of drivers) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return counts;
}

function DemoRace({ onExit }: { onExit: () => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="w-full shrink-0 space-y-2 md:w-[268px]">
          <TimingTower
            drivers={DEMO_DRIVERS}
            selectedId={selectedId}
            onSelect={(d) => setSelectedId((id) => (id === d.id ? undefined : d.id))}
          />
          <div className="glass flex items-center justify-between rounded-xl px-3 py-2 text-sm">
            <span>
              <span className="broadcast mr-2 rounded bg-f1 px-1.5 text-xs text-white">Demo</span>
              <span className="text-muted-foreground">Sample drivers</span>
            </span>
            <button type="button" onClick={onExit} className="text-sm text-muted-foreground hover:text-foreground">
              Exit demo
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <RaceControlBanner status="yellow" message="Auth · NIM & KAS" detail="auth/session.ts" />
          <RaceControlBanner status="blocked" message="JAN · rule: never touch .env" detail="edit hooks/.env" />
        </div>
      </div>
      <TeamRadioCard
        from="NIM"
        to="KAS"
        quote="Kasun, I'm in session.ts. Hold your edit."
        className="fixed inset-x-3 bottom-20 z-20 mx-auto max-w-[360px] md:bottom-6"
      />
    </>
  );
}

function Step({
  number,
  done,
  locked,
  title,
  children,
}: {
  number: number;
  done?: boolean;
  locked?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className={cn('flex gap-4 border-t border-white/5 px-5 py-4 first:border-t-0', locked && 'opacity-60')}>
      <span
        className={cn(
          'broadcast grid size-8 shrink-0 place-items-center rounded-full border border-glass-line text-sm tracking-normal',
          done && 'border-flag-green bg-flag-green/15 text-flag-green',
        )}
      >
        {done ? <Check className="size-4" aria-label="Done" /> : locked ? <Lock className="size-3.5" aria-hidden="true" /> : number}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function SessionRow({ session }: { session: AgentSession }) {
  const who = session.userName ?? session.userEmail;
  const status = session.status === 'active' ? 'working' : 'idle';
  return (
    <li className="flex items-center gap-3 border-t border-white/5 px-4 py-3 first:border-t-0">
      {session.status === 'ended' ? (
        <span className="w-[86px] shrink-0 text-sm text-muted-foreground">Ended</span>
      ) : (
        <StatusFlag status={status} className="w-[86px] shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {who}
          {session.repoName && <span className="text-muted-foreground"> · {session.repoName}</span>}
        </span>
        {session.lastAction && (
          <span className="block truncate font-mono text-xs text-muted-foreground">{session.lastAction}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(session.lastEventAt)}</span>
    </li>
  );
}

/** Before any agent is on track: the steps to connect, and the team's past sessions. */
function EmptyTrack({ sessions, onDemo }: { sessions: AgentSession[]; onDemo: () => void }) {
  const { me, team } = useTeamContext();
  const tokens = useTokens(team.id);
  const hasToken = (tokens.data ?? []).some((t) => t.userId === me.user.id);
  const connected = sessions.some((s) => s.userId === me.user.id);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-xl flex-col justify-center gap-6 py-6">
      <div className="space-y-2 text-center">
        <p className="broadcast text-sm text-f1">Pit wall</p>
        <h1 className="broadcast text-4xl sm:text-5xl">No cars on track</h1>
        <p className="text-muted-foreground">
          {sessions.length > 0 ? 'Agents appear here the moment they start working.' : 'Connect an agent and it shows up here, live.'}
        </p>
      </div>

      {!connected && <ConnectSteps hasToken={hasToken} teamId={team.id} />}

      {sessions.length > 0 && <SessionsPanel sessions={sessions} title="Recent sessions" />}

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        <button type="button" onClick={onDemo} className="text-foreground underline underline-offset-4">
          Watch a demo race
        </button>
        {team.role === 'lead' && (
          <Link to={`/t/${team.id}/team`} className="text-muted-foreground hover:text-foreground">
            Invite your team
          </Link>
        )}
      </div>
    </div>
  );
}

function ConnectSteps({ hasToken, teamId }: { hasToken: boolean; teamId: string }) {
  return (
    <ol aria-label="Connect your agent" className="glass overflow-hidden rounded-xl">
      <Step number={1} done={hasToken} title="Create an agent token">
        {hasToken ? (
          'Done. Make one for each machine you use.'
        ) : (
          <>
            One per machine, in{' '}
            <Link to={`/t/${teamId}/settings`} className="text-foreground underline underline-offset-2">
              Settings
            </Link>
            .
          </>
        )}
      </Step>
      <Step number={2} title="Add Race Control's hooks to Claude Code">
        Copy the settings from{' '}
        <Link to={`/t/${teamId}/settings#connect`} className="text-foreground underline underline-offset-2">
          Connect Claude Code
        </Link>{' '}
        into your project.
      </Step>
      <Step number={3} title="Start a coding session">
        Your agent appears here within seconds of its first action.
      </Step>
    </ol>
  );
}

function SessionsPanel({ sessions, title }: { sessions: AgentSession[]; title: string }) {
  return (
    <Panel title={title} aside={<span className="font-mono text-[11px] text-muted-foreground">{sessions.length}</span>}>
      <ul aria-label="Sessions">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </ul>
    </Panel>
  );
}

/** The selected driver's details and live command stream. */
function DriverPanel({
  driver,
  events,
  teamId,
  onClose,
}: {
  driver: TrackDriver;
  events: LiveEvent[];
  teamId: string;
  onClose: () => void;
}) {
  const stream = events.filter((e) => e.sessionId === driver.sessionId && e.type !== 'PostToolUse').slice(-24);
  return (
    <aside
      aria-label={`${driver.name}'s agent`}
      className="glass flex max-h-[calc(100dvh-7rem)] w-full flex-col gap-3 rounded-2xl p-4 md:w-[340px]"
    >
      <div className="flex items-center gap-3">
        <span className="broadcast grid size-10 place-items-center rounded-full bg-white/[0.06] text-sm tracking-normal">{driver.code}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium">{driver.name}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {driver.agent === 'codex' ? 'Codex' : 'Claude Code'}
            {driver.repo && ` · ${driver.repo}`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-muted-foreground hover:text-foreground">
          ×
        </button>
      </div>
      <div className="rounded-xl border border-glass-line bg-white/[0.03] p-3 text-sm">
        <StatusFlag status={driver.status} />
        {driver.lastAction && <p className="mt-1.5 truncate font-mono text-xs">{driver.lastAction}</p>}
      </div>
      <Link to={`/t/${teamId}/sessions/${driver.sessionId}`} className="text-sm text-muted-foreground hover:text-foreground">
        Open full timeline →
      </Link>
      <ol aria-label="Live commands" className="min-h-0 flex-1 overflow-y-auto font-mono text-xs leading-relaxed text-muted-foreground">
        {stream.length === 0 && <li>Waiting for the next action…</li>}
        {stream.map((e) => (
          <li key={e.id} className={cn('truncate', e.type === 'PostToolUseFailure' && 'text-flag-red')}>
            <span className="mr-2 text-muted-foreground/60">{new Date(e.createdAt).toLocaleTimeString([], { hour12: false })}</span>
            {e.summary}
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** Agents on track: the live map behind, the timing tower and the selected driver in front. */
const MAX_BANNERS = 3;

/** "NIM & KAS", "NIM, KAS & AMA": tower codes for drivers on track, short names for the rest. */
function flagMessage(flag: YellowFlag, drivers: TrackDriver[]): string {
  const codes = flag.drivers.map(
    (d) => drivers.find((t) => t.sessionId === d.sessionId)?.code ?? driverCodes([d.userName ?? d.userEmail])[0]!,
  );
  const names = codes.length > 1 ? `${codes.slice(0, -1).join(', ')} & ${codes.at(-1)}` : codes.join('');
  return `${names} · ${flag.repoName}`;
}

/** Race Control banners for the yellow flags, newest first. Dismissed ones return on a new overlap. */
function FlagBanners({ flags, drivers }: { flags: YellowFlag[]; drivers: TrackDriver[] }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const shown = flags.filter((f) => !dismissed.has(overlapKey(f)));
  if (shown.length === 0) return null;
  return (
    <div data-track-pass-through="" aria-label="Race Control" role="region" className="flex min-w-0 flex-1 flex-col items-center gap-2">
      {shown.slice(0, MAX_BANNERS).map((flag) => (
        <RaceControlBanner
          key={flag.id}
          status="yellow"
          message={flagMessage(flag, drivers)}
          detail={flag.target}
          onDismiss={() => setDismissed((old) => new Set(old).add(overlapKey(flag)))}
        />
      ))}
      {shown.length > MAX_BANNERS && (
        <span className="glass rounded-md px-2 py-0.5 text-xs text-muted-foreground">+{shown.length - MAX_BANNERS} more</span>
      )}
    </div>
  );
}

function LiveTrack({
  model,
  events,
  sessions,
  flags,
}: {
  model: TrackModel;
  events: LiveEvent[];
  sessions: AgentSession[];
  flags: YellowFlag[];
}) {
  const { me, team } = useTeamContext();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = model.drivers.find((d) => d.id === selectedId);
  const connected = sessions.some((s) => s.userId === me.user.id);

  return (
    <div data-track-pass-through="" className="flex min-h-[calc(100dvh-7rem)] flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <h1 className="sr-only">Pit wall</h1>
      <div className="w-full shrink-0 space-y-2 md:w-[268px]">
        <TimingTower
          drivers={model.drivers}
          selectedId={selectedId}
          onSelect={(d) => setSelectedId((id) => (id === d.id ? undefined : d.id))}
        />
        {!connected && (
          <Link
            to={`/t/${team.id}/settings#connect`}
            className="glass block rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Connect your own agent →
          </Link>
        )}
      </div>
      <FlagBanners flags={flags} drivers={model.drivers} />
      {selected && <DriverPanel driver={selected} events={events} teamId={team.id} onClose={() => setSelectedId(undefined)} />}
      <div className="md:hidden">
        <SessionsPanel sessions={sessions.filter((s) => s.status !== 'ended')} title="On track" />
      </div>
      <TrackMap model={model} selectedId={selectedId} onSelect={setSelectedId} />
    </div>
  );
}

/** Re-renders every 15 s, so drivers who've gone quiet leave the track without a new event. */
function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PitWallPage() {
  const { me, team, live } = useTeamContext();
  const [params, setParams] = useSearchParams();
  const demo = params.get('demo') === '1';
  const sessions = useSessions(team.id, { poll: live !== 'live' });
  const events = useTeamEvents(team.id);
  const flags = useFlags(team.id, { poll: live !== 'live' });
  const now = useNow();
  const flying = useMemo(() => activeFlags(flags.data ?? [], now), [flags.data, now]);
  const model = useMemo(
    () => buildTrackModel(sessions.data ?? [], events.data ?? [], now, flying),
    [sessions.data, events.data, now, flying],
  );
  const onTrack = model.drivers.length > 0;

  return (
    <>
      <LightsOut />
      <AppShell
        team={team}
        teams={me.teams}
        active="pit-wall"
        userEmail={me.user.email}
        counts={demo ? countByStatus(DEMO_DRIVERS) : onTrack ? countByStatus(model.drivers) : undefined}
        scene={onTrack && !demo ? null : undefined}
        actions={
          demo ? (
            <LiveClock since={DEMO_START} className="hidden sm:inline-flex" />
          ) : (
            <LiveBadge status={live} className="hidden sm:inline-flex" />
          )
        }
      >
        {demo ? (
          <>
            <h1 className="sr-only">Pit wall demo</h1>
            <DemoRace onExit={() => setParams({})} />
          </>
        ) : onTrack ? (
          <LiveTrack model={model} events={events.data ?? []} sessions={sessions.data ?? []} flags={flying} />
        ) : (
          <EmptyTrack sessions={sessions.data ?? []} onDemo={() => setParams({ demo: '1' })} />
        )}
      </AppShell>
    </>
  );
}
