import { Check, Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { LightsOut } from '@/components/lights-out';
import { LiveClock } from '@/components/live-clock';
import { RaceControlBanner } from '@/components/race-control-banner';
import type { FlagStatus } from '@/components/status-flag';
import { TeamRadioCard } from '@/components/team-radio-card';
import { TimingTower, type Driver } from '@/components/timing-tower';
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

/** What a team sees before any agent is connected: an empty track and the three steps to put a car on it. */
function EmptyTrack({ onDemo }: { onDemo: () => void }) {
  const { me, team } = useTeamContext();
  const tokens = useTokens(team.id);
  const hasToken = (tokens.data ?? []).some((t) => t.userId === me.user.id);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-xl flex-col justify-center gap-6 py-6">
      <div className="space-y-2 text-center">
        <p className="broadcast text-sm text-f1">Pit wall</p>
        <h1 className="broadcast text-4xl sm:text-5xl">No cars on track</h1>
        <p className="text-muted-foreground">Connect an agent and it shows up here, live.</p>
      </div>

      <ol aria-label="Connect your agent" className="glass overflow-hidden rounded-xl">
        <Step number={1} done={hasToken} title="Create an agent token">
          {hasToken ? (
            'Done. Make one for each machine you use.'
          ) : (
            <>
              One per machine, in{' '}
              <Link to={`/t/${team.id}/settings`} className="text-foreground underline underline-offset-2">
                Settings
              </Link>
              .
            </>
          )}
        </Step>
        <Step number={2} locked title="Add Race Control's hooks to Claude Code">
          Arrives with the next update: a settings snippet to paste into your project.
        </Step>
        <Step number={3} locked title="Start a coding session">
          Your agent appears on this track, with every tool call, flag and approval.
        </Step>
      </ol>

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

export function PitWallPage() {
  const { me, team } = useTeamContext();
  const [params, setParams] = useSearchParams();
  const demo = params.get('demo') === '1';

  return (
    <>
      <LightsOut />
      <AppShell
        team={team}
        teams={me.teams}
        active="pit-wall"
        userEmail={me.user.email}
        counts={demo ? countByStatus(DEMO_DRIVERS) : undefined}
        actions={demo ? <LiveClock since={DEMO_START} className="hidden sm:inline-flex" /> : undefined}
      >
        {demo ? (
          <>
            <h1 className="sr-only">Pit wall demo</h1>
            <DemoRace onExit={() => setParams({})} />
          </>
        ) : (
          <EmptyTrack onDemo={() => setParams({ demo: '1' })} />
        )}
      </AppShell>
    </>
  );
}
