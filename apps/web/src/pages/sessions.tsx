import type { AgentSession, SessionStatus } from '@race-control/shared';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { Panel } from '@/components/panel';
import { StatusFlag } from '@/components/status-flag';
import { useSessions } from '@/lib/sessions';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useTeamContext } from '@/routes';

const FILTERS: Array<{ value: SessionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Working' },
  { value: 'idle', label: 'Idle' },
  { value: 'ended', label: 'Ended' },
];

/** "4m", "1h 12m": how long a session has been going (or went). */
export function duration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function SessionLink({ session, teamId }: { session: AgentSession; teamId: string }) {
  return (
    <li className="border-t border-white/5 first:border-t-0">
      <Link
        to={`/t/${teamId}/sessions/${session.id}`}
        className="flex items-center gap-2 px-4 py-3 transition-colors sm:gap-3 hover:bg-white/[0.04]"
      >
        {session.status === 'ended' ? (
          <span className="w-[72px] shrink-0 text-sm text-muted-foreground sm:w-[86px]">Ended</span>
        ) : (
          <StatusFlag status={session.status === 'active' ? 'working' : 'idle'} className="w-[72px] shrink-0 sm:w-[86px]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {session.userName ?? session.userEmail}
            {session.repoName && <span className="text-muted-foreground"> · {session.repoName}</span>}
          </span>
          {session.lastAction && <span className="block truncate font-mono text-xs text-muted-foreground">{session.lastAction}</span>}
        </span>
        <span className="hidden shrink-0 text-right font-mono text-xs text-muted-foreground sm:block">
          {session.toolCalls} {session.toolCalls === 1 ? 'lap' : 'laps'} · {duration(session.startedAt, session.lastEventAt)}
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground sm:w-20">{timeAgo(session.lastEventAt)}</span>
        <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function SessionsPage() {
  const { me, team, live } = useTeamContext();
  const sessions = useSessions(team.id, { poll: live !== 'live' });
  const [filter, setFilter] = useState<SessionStatus | 'all'>('all');
  const shown = (sessions.data ?? []).filter((s) => filter === 'all' || s.status === filter);

  return (
    <AppShell team={team} teams={me.teams} active="sessions" userEmail={me.user.email}>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="broadcast text-2xl">Sessions</h1>
          <div role="radiogroup" aria-label="Show sessions" className="glass flex rounded-xl p-1">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                onClick={() => setFilter(value)}
                className={cn('h-8 rounded-lg px-3 text-sm text-muted-foreground', filter === value && 'bg-white/10 text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Panel title="Latest 50" aside={<span className="font-mono text-[11px] text-muted-foreground">{shown.length}</span>}>
          {sessions.isPending && (
            <div role="status" className="space-y-3 p-4">
              <span className="sr-only">Loading sessions</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          )}
          {sessions.isError && (
            <p role="alert" className="p-4 text-sm text-flag-red">
              Couldn't load sessions.
            </p>
          )}
          {sessions.data && shown.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {filter === 'all' ? 'No sessions yet. Connect an agent in Settings and its sessions appear here.' : 'None right now.'}
            </p>
          )}
          {shown.length > 0 && (
            <ul aria-label="Sessions">
              {shown.map((session) => (
                <SessionLink key={session.id} session={session} teamId={team.id} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
