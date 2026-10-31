import { approvalSchema, type Approval, type ApprovalDecision } from '@race-control/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';

export const approvalsKey = (teamId: string) => ['teams', teamId, 'approvals'] as const;

/**
 * Waiting approvals and the last day's decisions, newest first. The live channel keeps them current;
 * `poll` refreshes every 10 s instead, for while that channel is down.
 */
export function useApprovals(teamId: string, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: approvalsKey(teamId),
    queryFn: () => api(`/teams/${teamId}/approvals`, { schema: z.array(approvalSchema) }),
    refetchInterval: options.poll ? 10_000 : false,
  });
}

/** One approval, for the phone screen. Starts from the list if it's already loaded. */
export function useApproval(teamId: string, approvalId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...approvalsKey(teamId), approvalId],
    queryFn: () => api(`/teams/${teamId}/approvals/${approvalId}`, { schema: approvalSchema }),
    initialData: () => queryClient.getQueryData<Approval[]>(approvalsKey(teamId))?.find((a) => a.id === approvalId),
    retry: false,
  });
}

/** Adds or replaces an approval, keeping the list newest first. */
export function upsertApproval(list: Approval[], approval: Approval): Approval[] {
  return [approval, ...list.filter((a) => a.id !== approval.id)].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/** Puts an approval into both the list and its own cache entry. */
export function storeApproval(queryClient: QueryClient, teamId: string, approval: Approval) {
  queryClient.setQueryData<Approval[]>(approvalsKey(teamId), (old) => (old ? upsertApproval(old, approval) : old));
  queryClient.setQueryData<Approval>([...approvalsKey(teamId), approval.id], approval);
}

/** Oldest first: the one that runs out soonest is answered first. */
export function waitingApprovals(list: Approval[]): Approval[] {
  return list.filter((a) => a.status === 'pending').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** Leads only. The first answer wins; a late one gets 409 and the list is refreshed. */
export function useDecide(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, decision }: ApprovalDecision & { approvalId: string }) =>
      api(`/teams/${teamId}/approvals/${approvalId}/decision`, { method: 'POST', body: { decision }, schema: approvalSchema }),
    onSuccess: (approval) => storeApproval(queryClient, teamId, approval),
    onError: () => queryClient.invalidateQueries({ queryKey: approvalsKey(teamId) }),
  });
}

/** Seconds left until `expiresAt`, ticking every second. */
export function useCountdown(expiresAt: string): number {
  const [seconds, setSeconds] = useState(() => secondsLeft(expiresAt));
  useEffect(() => {
    setSeconds(secondsLeft(expiresAt));
    const id = setInterval(() => setSeconds(secondsLeft(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return seconds;
}

const secondsLeft = (expiresAt: string) => Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));

/** "3:59". */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const VERBS: Record<string, string> = { Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Bash: 'run' };

/** "write", "edit", "run": what the agent wants to do. */
export function approvalVerb(approval: Approval): string {
  return approval.toolName ? (VERBS[approval.toolName] ?? approval.toolName.toLowerCase()) : 'act';
}

export const approvalWho = (approval: Approval) => approval.userName ?? approval.userEmail.split('@')[0]!;
