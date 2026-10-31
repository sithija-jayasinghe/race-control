import type { Approval } from '@race-control/shared';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { agentName, approvalOutcome, Countdown, DecideButtons } from '@/components/approval-card';
import { Panel } from '@/components/panel';
import { approvalVerb, approvalWho, useApproval, useApprovals, waitingApprovals } from '@/lib/approvals';
import { cn } from '@/lib/utils';
import { useTeamContext } from '@/routes';

const BLUE_KERB = { '--kerb': 'var(--flag-blue)' } as CSSProperties;

const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** GO, STOP or OUT, like the timing screens. */
const RESULT: Record<Exclude<Approval['status'], 'pending'>, { label: string; className: string }> = {
  approved: { label: 'Go', className: 'text-flag-green' },
  denied: { label: 'Stop', className: 'text-flag-red' },
  expired: { label: 'Out', className: 'text-muted-foreground' },
};

/** "approved by you · 10:42", "no answer in 4 min · 08:03". */
function decidedLine(approval: Approval, myId: string): string {
  const by = approval.decidedBy ? (approval.decidedBy.userId === myId ? 'you' : approval.decidedBy.name) : null;
  const when = approval.decidedAt ? ` · ${at(approval.decidedAt)}` : '';
  if (approval.status === 'approved') return `approved by ${by ?? 'a lead'}${when}`;
  if (approval.status === 'denied') return `denied by ${by ?? 'a lead'}${when}`;
  const minutes = Math.round((Date.parse(approval.expiresAt) - Date.parse(approval.requestedAt)) / 60_000);
  return `no answer in ${minutes} min${when}`;
}

function WaitingRow({ approval, teamId, canDecide }: { approval: Approval; teamId: string; canDecide: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/5 px-4 py-3 shadow-[inset_3px_0_0_var(--flag-blue)] first:border-t-0">
      <span className="broadcast w-10 shrink-0 text-[11px] text-flag-blue">Pit</span>
      <Link to={`/t/${teamId}/approvals/${approval.id}`} className="min-w-0 flex-1 hover:underline">
        <span className="block truncate text-sm">
          {approvalWho(approval)} · {approvalVerb(approval)}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{approval.target ?? approval.summary}</span>
      </Link>
      <Countdown approval={approval} className="text-xs" />
      <div className="w-full sm:w-44">
        <DecideButtons approval={approval} teamId={teamId} canDecide={canDecide} />
      </div>
    </li>
  );
}

function HistoryRow({ approval, teamId, myId }: { approval: Approval; teamId: string; myId: string }) {
  const result = RESULT[approval.status as keyof typeof RESULT];
  return (
    <li>
      <Link
        to={`/t/${teamId}/sessions/${approval.sessionId}`}
        className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-[13px] text-muted-foreground hover:bg-white/[0.04]"
      >
        <span className={cn('broadcast w-10 shrink-0 text-[11px]', result.className)}>{result.label}</span>
        {/* On phones the answer drops below, so the target isn't cut short. */}
        <span className="min-w-0 flex-1 truncate max-sm:basis-[calc(100%-3.25rem)]">
          {approvalWho(approval)} · {approvalVerb(approval)} <span className="font-mono text-xs">{approval.target ?? approval.summary}</span>
        </span>
        <span className="shrink-0 text-xs max-sm:ml-[3.25rem]">{decidedLine(approval, myId)}</span>
      </Link>
    </li>
  );
}

/** Waiting approvals at the top, the last day's answers below. */
export function ApprovalsPage() {
  const { me, team, live } = useTeamContext();
  const approvals = useApprovals(team.id, { poll: live !== 'live' });
  const list = approvals.data ?? [];
  const waiting = waitingApprovals(list);
  const history = list.filter((a) => a.status !== 'pending');
  const canDecide = team.role === 'lead';

  return (
    <AppShell team={team} teams={me.teams} active="approvals" userEmail={me.user.email}>
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="broadcast text-2xl">Approvals</h1>
        <Panel title="Pit lane" aside={<span className="font-mono text-[11px] text-muted-foreground">{waiting.length}</span>}>
          {approvals.isPending && (
            <div role="status" className="space-y-3 p-4">
              <span className="sr-only">Loading approvals</span>
              {[0, 1].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          )}
          {approvals.isError && (
            <p role="alert" className="p-4 text-sm text-flag-red">
              Couldn't load approvals.
            </p>
          )}
          {approvals.data && waiting.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nothing waiting. Agents stop here when a{' '}
              <Link to={`/t/${team.id}/rules`} className="text-foreground underline underline-offset-2">
                rule
              </Link>{' '}
              needs a lead.
            </p>
          )}
          {waiting.length > 0 && (
            <ul aria-label="Waiting">
              {waiting.map((approval) => (
                <WaitingRow key={approval.id} approval={approval} teamId={team.id} canDecide={canDecide} />
              ))}
            </ul>
          )}
          {history.length > 0 && (
            <>
              <h2 className="px-4 pt-3 pb-1 text-[11px] text-muted-foreground">Last 24 hours</h2>
              <ul aria-label="Last 24 hours" className="pb-2">
                {history.map((approval) => (
                  <HistoryRow key={approval.id} approval={approval} teamId={team.id} myId={me.user.id} />
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

/** One approval, laid out for a phone: the clock big, the buttons in thumb reach. */
export function ApprovalPage() {
  const { me, team } = useTeamContext();
  const { approvalId = '' } = useParams();
  const approval = useApproval(team.id, approvalId);
  const data = approval.data;

  return (
    <AppShell team={team} teams={me.teams} active="approvals" userEmail={me.user.email}>
      <div className="mx-auto max-w-sm space-y-3">
        {approval.isPending && (
          <div role="status" className="glass h-80 animate-pulse rounded-2xl">
            <span className="sr-only">Loading approval</span>
          </div>
        )}
        {approval.isError && (
          <div role="alert" className="glass space-y-2 rounded-2xl p-6">
            <h1 className="broadcast text-2xl">Off track</h1>
            <p className="text-sm text-muted-foreground">This approval doesn't exist, or it's from another team.</p>
          </div>
        )}
        {data && (
          <section className="glass overflow-hidden rounded-2xl">
            <div className="kerb" style={BLUE_KERB} aria-hidden="true" />
            <div className="space-y-4 p-5">
              <div>
                <h1 className="broadcast text-sm text-flag-blue">Pit lane</h1>
                {data.status === 'pending' && <Countdown approval={data} className="mt-1 block text-4xl" />}
              </div>
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium">{approvalWho(data)}</span> wants to {approvalVerb(data)}
                </p>
                <p className="rounded-[10px] border border-glass-line bg-black/35 px-2.5 py-2 font-mono text-xs break-all">
                  {data.target ?? data.summary}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rule: {data.ruleName}
                  <br />
                  {data.repoName && `${data.repoName} · `}
                  {agentName(data)}
                </p>
              </div>
              {data.status === 'pending' ? (
                <DecideButtons approval={data} teamId={team.id} canDecide={team.role === 'lead'} stacked />
              ) : (
                <p role="status" className={cn('text-center text-sm', RESULT[data.status].className)}>
                  {approvalOutcome(data)}
                  <span className="mt-1 block text-xs text-muted-foreground">{decidedLine(data, me.user.id)}</span>
                </p>
              )}
            </div>
          </section>
        )}
        <Link to={`/t/${team.id}/approvals`} className="block text-center text-sm text-muted-foreground hover:text-foreground">
          All approvals
        </Link>
      </div>
    </AppShell>
  );
}
