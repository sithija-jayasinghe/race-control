import { EDIT_TOOLS, type AgentSession, type LiveEvent, type TimelineEvent } from '@race-control/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  CircleStop,
  FilePen,
  FileText,
  Flag,
  Globe,
  Play,
  Search,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { Panel } from '@/components/panel';
import { StatusFlag } from '@/components/status-flag';
import { activeFlags, useFlags } from '@/lib/flags';
import { eventsKey } from '@/lib/live';
import { sessionsKey, useSessionTimeline } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import { duration } from '@/pages/sessions';
import { useTeamContext } from '@/routes';

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Edit: FilePen,
  MultiEdit: FilePen,
  Write: FilePen,
  Bash: SquareTerminal,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Agent: Bot,
  Task: Bot,
};

const EDITS: readonly string[] = EDIT_TOOLS;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

/**
 * Steps worth showing: every tool call, failures, and the session's milestones. Successful results
 * (PostToolUse) are left out because the call above them already says what happened.
 */
export function timelineSteps(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((e) => e.type !== 'PostToolUse');
}

/** Adds steps that arrived on the live channel since the timeline was loaded. */
export function mergeLive(fetched: TimelineEvent[], live: LiveEvent[], sessionId: string): TimelineEvent[] {
  const known = new Set(fetched.map((e) => e.id));
  const newer = live.filter((e) => e.sessionId === sessionId && !known.has(e.id)).map((e) => ({ ...e, detail: null }));
  return [...fetched, ...newer].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function Step({ event, flagged }: { event: TimelineEvent; flagged: boolean }) {
  let Icon: LucideIcon = TOOL_ICONS[event.toolName ?? ''] ?? Wrench;
  let label = event.summary ?? event.type;
  let tone = '';
  if (event.type === 'SessionStart') {
    Icon = Play;
    label = 'Session started';
    tone = 'text-flag-green';
  } else if (event.type === 'Stop') {
    Icon = Flag;
    label = 'Finished responding';
    tone = 'text-muted-foreground';
  } else if (event.type === 'SessionEnd') {
    Icon = CircleStop;
    label = 'Session ended';
    tone = 'text-muted-foreground';
  } else if (event.type === 'PostToolUseFailure') {
    Icon = X;
    tone = 'text-flag-red';
  }
  if (flagged) tone = 'text-flag-yellow';
  if (event.decision === 'deny') tone = 'text-flag-red';
  if (event.decision === 'pending') tone = 'text-flag-blue';

  return (
    <li className="grid grid-cols-[64px_20px_minmax(0,1fr)] items-start gap-3 px-4 py-2">
      <time className="pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">{time(event.createdAt)}</time>
      <Icon className={cn('mt-0.5 size-4', tone || 'text-muted-foreground')} aria-hidden="true" />
      <span className="min-w-0">
        <span className={cn('block truncate font-mono text-xs', tone)}>
          {label}
          {flagged && <span className="broadcast ml-2 rounded bg-flag-yellow px-1 text-[10px] text-[#0b0c0f]">Yellow flag</span>}
        </span>
        {event.detail && <span className="block truncate font-mono text-[11px] text-muted-foreground">{event.detail}</span>}
      </span>
    </li>
  );
}

function Header({ session, failures }: { session: AgentSession; failures: number }) {
  const facts = [
    session.agent === 'codex' ? 'Codex' : 'Claude Code',
    session.repoName,
    `started ${new Date(session.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`,
    duration(session.startedAt, session.lastEventAt),
    `${session.toolCalls} ${session.toolCalls === 1 ? 'tool call' : 'tool calls'}`,
    failures > 0 ? `${failures} failed` : null,
  ].filter(Boolean);
  return (
    <div className="glass space-y-2 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="broadcast text-2xl">{session.userName ?? session.userEmail}</h1>
        {session.status === 'ended' ? (
          <span className="text-sm text-muted-foreground">Ended</span>
        ) : (
          <StatusFlag status={session.status === 'active' ? 'working' : 'idle'} />
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{facts.join(' · ')}</p>
    </div>
  );
}

export function SessionPage() {
  const { me, team } = useTeamContext();
  const { sessionId = '' } = useParams();
  const timeline = useSessionTimeline(team.id, sessionId);
  // The live channel keeps these two caches current; read them so the timeline grows as the agent works.
  const liveEvents = useQuery<LiveEvent[]>({ queryKey: eventsKey(team.id), enabled: false }).data ?? [];
  const liveSession = useQuery<AgentSession[]>({ queryKey: sessionsKey(team.id), enabled: false }).data?.find(
    (s) => s.id === sessionId,
  );

  const flags = useFlags(team.id).data ?? [];

  const session = liveSession ?? timeline.data?.session;
  // Edits to a file this session shares with another one right now.
  const flaggedFiles = new Set(
    activeFlags(flags, Date.now())
      .filter((f) => f.repoName === session?.repoName && f.drivers.some((d) => d.sessionId === sessionId))
      .map((f) => f.target),
  );
  const isFlagged = (e: TimelineEvent) =>
    e.type === 'PreToolUse' && EDITS.includes(e.toolName ?? '') && e.target !== null && flaggedFiles.has(e.target);
  const events = timeline.data ? timelineSteps(mergeLive(timeline.data.events, liveEvents, sessionId)) : [];
  const failures = events.filter((e) => e.type === 'PostToolUseFailure').length;

  return (
    <AppShell team={team} teams={me.teams} active="sessions" userEmail={me.user.email}>
      <div className="mx-auto max-w-4xl space-y-4">
        <Link to={`/t/${team.id}/sessions`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Sessions
        </Link>
        {timeline.isPending && (
          <div role="status" className="glass h-24 animate-pulse rounded-xl">
            <span className="sr-only">Loading session</span>
          </div>
        )}
        {timeline.isError && (
          <div role="alert" className="glass space-y-2 rounded-xl p-6">
            <h1 className="broadcast text-2xl">Session not found</h1>
            <p className="text-sm text-muted-foreground">It may belong to another team, or the link is wrong.</p>
          </div>
        )}
        {session && timeline.data && (
          <>
            <Header session={session} failures={failures} />
            <Panel
              title="Timeline"
              aside={<span className="font-mono text-[11px] text-muted-foreground">{events.length} steps</span>}
            >
              {timeline.data.truncated && (
                <p className="px-4 pt-3 text-xs text-muted-foreground">Showing the latest 1,000 events of a long session.</p>
              )}
              <ol aria-label="Timeline" className="py-2">
                {events.map((event) => (
                  <Step key={event.id} event={event} flagged={isFlagged(event)} />
                ))}
              </ol>
            </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}
