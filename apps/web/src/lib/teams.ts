import {
  createdInviteSchema,
  invitePreviewSchema,
  inviteSchema,
  memberSchema,
  myTeamSchema,
  type Role,
} from '@race-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';
import { meQueryKey } from '@/lib/auth';

const membersKey = (teamId: string) => ['teams', teamId, 'members'] as const;
const invitesKey = (teamId: string) => ['teams', teamId, 'invites'] as const;

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api('/teams', { method: 'POST', body: { name }, schema: myTeamSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}

export function useMembers(teamId: string) {
  return useQuery({
    queryKey: membersKey(teamId),
    queryFn: () => api(`/teams/${teamId}/members`, { schema: z.array(memberSchema) }),
  });
}

export function useChangeRole(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { role } }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: membersKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

export function useRemoveMember(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: membersKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

/** Active invite links. Leads only; `enabled` keeps developers from asking. */
export function useInvites(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: invitesKey(teamId),
    queryFn: () => api(`/teams/${teamId}/invites`, { schema: z.array(inviteSchema) }),
    enabled,
  });
}

export function useCreateInvite(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) =>
      api(`/teams/${teamId}/invites`, { method: 'POST', body: { role }, schema: createdInviteSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitesKey(teamId) }),
  });
}

export function useRevokeInvite(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api(`/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitesKey(teamId) }),
  });
}

export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => api('/invites/preview', { method: 'POST', body: { token }, schema: invitePreviewSchema }),
    enabled: token !== null,
    retry: false,
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api('/invites/accept', { method: 'POST', body: { token }, schema: myTeamSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}

// An invite opened while signed out is kept here until sign-in finishes, then used and forgotten.
const PENDING_INVITE_KEY = 'rc-invite';

export function rememberInvite(token: string) {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Without storage, the person opens the invite link again after signing in.
  }
}

export function readPendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function forgetInvite() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
