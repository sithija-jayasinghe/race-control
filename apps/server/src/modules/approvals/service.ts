import { alwaysAllowPattern, MAX_RULES, type Approval, type ApprovalDecision, type ApprovalDecisionResult } from '@race-control/shared';
import type { AppDeps } from '../../app.ts';
import type { DbOrTx } from '../../db/client.ts';
import type { TeamAuth } from '../../plugins/team-access.ts';
import { countRules, findRuleTool, insertRule } from '../rules/repo.ts';
import { findApproval, serializeApproval, settleApproval, updateEventOutcome } from './repo.ts';

type Deps = Pick<AppDeps, 'db' | 'now' | 'bus' | 'approvals' | 'approvalWaitMs' | 'rules'>;

function waitText(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

async function publishApproval(deps: Deps, teamId: string, approvalId: string): Promise<Approval | undefined> {
  const row = await findApproval(deps.db, teamId, approvalId);
  if (!row) return undefined;
  const approval = serializeApproval(row, deps.approvalWaitMs);
  deps.bus.publish(teamId, { type: 'approval', approval });
  return approval;
}

/**
 * Holds a tool call until a lead decides, the wait runs out, or the agent hangs up. Returns what to tell
 * Claude Code. Reasons never include a person's name: they reach the agent, and names are typed by people.
 */
export async function holdForApproval(
  deps: Deps,
  call: { teamId: string; approvalId: string; ruleName: string; signal?: AbortSignal },
): Promise<{ decision: 'allow' | 'deny'; reason: string }> {
  const { teamId, approvalId } = call;
  await publishApproval(deps, teamId, approvalId);
  const reason = await deps.approvals.wait(approvalId, deps.approvalWaitMs, call.signal);
  // Whatever woke us, the database has the answer. Expiring only counts if nobody decided first.
  if (reason !== 'woken' && (await settleApproval(deps.db, teamId, approvalId, 'expired', null, deps.now()))) {
    await publishApproval(deps, teamId, approvalId);
  }

  const row = await findApproval(deps.db, teamId, approvalId);
  const status = row?.status ?? 'expired';
  const decision = status === 'approved' ? 'allow' : 'deny';
  await updateEventOutcome(deps.db, teamId, row?.eventId ?? '', decision, { status, by: row?.deciderName ?? row?.deciderEmail?.split('@')[0] ?? null });
  if (status === 'approved') return { decision, reason: `Approved by a team lead in Race Control (team rule: ${call.ruleName})` };
  if (status === 'denied') return { decision, reason: `Denied by a team lead in Race Control (team rule: ${call.ruleName})` };
  return { decision, reason: `No approval within ${waitText(deps.approvalWaitMs)} (team rule: ${call.ruleName})` };
}

export type DecideResult = ApprovalDecisionResult | 'not_found' | 'already_decided';

/**
 * "Always allow this": a live allow rule for exactly the approved file or command, using the approve
 * rule's tools. Null when the call has nothing exact to allow, or the team is at its rule limit.
 */
async function addAllowRule(db: DbOrTx, auth: TeamAuth, approvalId: string, now: Date): Promise<ApprovalDecisionResult['allowRule']> {
  const row = await findApproval(db, auth.teamId, approvalId);
  const pattern = row && alwaysAllowPattern(row);
  const tool = row && (await findRuleTool(db, auth.teamId, row.ruleId));
  if (!pattern || !tool || (await countRules(db, auth.teamId)) >= MAX_RULES) return null;
  const rule = await insertRule(db, {
    teamId: auth.teamId,
    createdBy: auth.userId,
    name: `Allow: ${pattern}`.slice(0, 100).trimEnd(),
    tool,
    pattern,
    action: 'allow',
    mode: 'enforce',
    now,
  });
  return { id: rule.id, name: rule.name };
}

/** A lead approves or denies. The first answer wins; the held request is woken to pass it on. */
export async function decideApproval(deps: Deps, auth: TeamAuth, approvalId: string, body: ApprovalDecision): Promise<DecideResult> {
  const status = body.decision === 'approve' ? 'approved' : 'denied';
  const now = deps.now();
  const settled = await deps.db.transaction(async (tx) => {
    if (!(await settleApproval(tx, auth.teamId, approvalId, status, auth.userId, now))) return false;
    return { allowRule: status === 'approved' && body.alwaysAllow ? await addAllowRule(tx, auth, approvalId, now) : null };
  });
  if (!settled) return (await findApproval(deps.db, auth.teamId, approvalId)) ? 'already_decided' : 'not_found';

  if (settled.allowRule) deps.rules.invalidate(auth.teamId);
  deps.approvals.wake(approvalId);
  const approval = await publishApproval(deps, auth.teamId, approvalId);
  return approval ? { approval, allowRule: settled.allowRule } : 'not_found';
}
