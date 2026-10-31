import type { Approval } from '@race-control/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/lib/api';
import { approvalVerb, approvalWho, clock, useCountdown, useDecide } from '@/lib/approvals';
import { cn } from '@/lib/utils';

const BLUE_KERB = { '--kerb': 'var(--flag-blue)' } as CSSProperties;

/** "4 minutes": how long Race Control waited. */
export function waitLabel(approval: Approval): string {
  const minutes = Math.round((Date.parse(approval.expiresAt) - Date.parse(approval.requestedAt)) / 60_000);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** What happened, in a sentence. */
export function approvalOutcome(approval: Approval): string {
  const who = approvalWho(approval);
  if (approval.status === 'approved') return `Approved. ${who}’s agent carries on.`;
  if (approval.status === 'denied') return `Denied. ${who}’s agent is told why.`;
  return `No answer in ${waitLabel(approval)}. Denied.`;
}

export const agentName = (approval: Approval) => (approval.agent === 'codex' ? 'Codex' : 'Claude Code');

/** The live countdown, "3:59". */
export function Countdown({ approval, className }: { approval: Approval; className?: string }) {
  const seconds = useCountdown(approval.expiresAt);
  return (
    <span role="timer" aria-label={`${clock(seconds)} left`} className={cn('font-mono text-flag-blue tabular-nums', className)}>
      {clock(seconds)}
    </span>
  );
}

function decideError(error: unknown): string {
  return error instanceof ApiError && error.status === 409 ? 'Another lead answered first.' : 'Couldn’t send that. Try again.';
}

/**
 * Deny and Approve for leads; everyone else waits for one. `stacked` puts Approve on top, for thumbs on a phone.
 */
export function DecideButtons({
  approval,
  teamId,
  canDecide,
  stacked = false,
}: {
  approval: Approval;
  teamId: string;
  canDecide: boolean;
  stacked?: boolean;
}) {
  const decide = useDecide(teamId);
  if (!canDecide) return <p className="py-2 text-center text-sm text-muted-foreground">Waiting for a lead</p>;

  const button = (decision: 'approve' | 'deny') => (
    <button
      type="button"
      disabled={decide.isPending}
      onClick={() => decide.mutate({ approvalId: approval.id, decision })}
      className={cn(
        'rounded-[10px] border text-sm disabled:opacity-60',
        stacked ? 'py-3.5' : 'py-2',
        decision === 'approve' ? 'border-transparent bg-foreground font-medium text-background' : 'border-white/15 hover:bg-white/5',
      )}
    >
      {decision === 'approve' ? 'Approve' : 'Deny'}
    </button>
  );
  return (
    <div>
      <div className={cn('grid gap-2', !stacked && 'grid-cols-2')}>
        {stacked ? button('approve') : button('deny')}
        {stacked ? button('deny') : button('approve')}
      </div>
      {decide.isError && (
        <p role="alert" className="mt-2 text-center text-xs text-flag-red">
          {decideError(decide.error)}
        </p>
      )}
    </div>
  );
}

/** A held tool call on the Pit wall: who, what, which rule, and the clock running down. */
export function ApprovalCard({
  approval,
  teamId,
  canDecide,
  moreWaiting = 0,
  className,
}: {
  approval: Approval;
  teamId: string;
  canDecide: boolean;
  /** Other approvals behind this one. */
  moreWaiting?: number;
  className?: string;
}) {
  const who = approvalWho(approval);
  const settled = approval.status !== 'pending';
  const seconds = useCountdown(approval.expiresAt);
  const total = (Date.parse(approval.expiresAt) - Date.parse(approval.requestedAt)) / 1000;

  return (
    <section aria-label={`Pit lane: ${who} wants to ${approvalVerb(approval)}`} className={cn('glass overflow-hidden rounded-xl border-flag-blue/35', className)}>
      <div className="kerb" style={BLUE_KERB} aria-hidden="true" />
      <div className="p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <Link to={`/t/${teamId}/approvals/${approval.id}`} className="broadcast text-flag-blue hover:underline">
            Pit lane
          </Link>
          <span className="flex items-center gap-3">
            {moreWaiting > 0 && (
              <Link to={`/t/${teamId}/approvals`} className="text-muted-foreground hover:text-foreground">
                +{moreWaiting} waiting
              </Link>
            )}
            {!settled && <Countdown approval={approval} />}
          </span>
        </div>
        <p className="mt-2 mb-1.5 text-sm">
          <span className="font-medium">{who}</span> wants to {approvalVerb(approval)}
        </p>
        <p title={approval.target ?? undefined} className="truncate rounded-[10px] border border-glass-line bg-black/35 px-2.5 py-2 font-mono text-xs">
          {approval.target ?? approval.summary}
        </p>
        <p className="mt-1.5 flex justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="truncate">{approval.ruleName}</span>
          <span className="shrink-0">
            {approval.repoName && `${approval.repoName} · `}
            {agentName(approval)}
          </span>
        </p>
        {settled ? (
          <p
            role="status"
            className={cn(
              'pt-3 pb-1 text-center text-sm',
              approval.status === 'approved' ? 'text-flag-green' : approval.status === 'denied' ? 'text-flag-red' : 'text-muted-foreground',
            )}
          >
            {approvalOutcome(approval)}
          </p>
        ) : (
          <>
            <div aria-hidden="true" className="my-2.5 h-0.5 overflow-hidden rounded-full bg-white/10">
              <i
                className="block h-full bg-flag-blue transition-[width] duration-1000 ease-linear"
                style={{ width: `${total > 0 ? (seconds / total) * 100 : 0}%` }}
              />
            </div>
            <DecideButtons approval={approval} teamId={teamId} canDecide={canDecide} />
          </>
        )}
      </div>
    </section>
  );
}
