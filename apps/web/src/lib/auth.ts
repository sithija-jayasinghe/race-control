import { meResponseSchema, userSchema, type MeResponse } from '@race-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, api } from '@/lib/api';

export const meQueryKey = ['me'] as const;

/** The signed-in user and their teams, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await api('/me', { schema: meResponseSchema });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (email: string) =>
      api('/auth/magic-link', { method: 'POST', body: { email }, schema: z.object({ ok: z.literal(true) }) }),
  });
}

export function useVerifyMagicLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api('/auth/verify', { method: 'POST', body: { token }, schema: z.object({ user: userSchema }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.setQueryData(meQueryKey, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
    },
  });
}

// Where to go after signing in. Kept in localStorage because the magic link often opens in a new tab.
const NEXT_KEY = 'rc-next';

/** Only same-site paths are allowed, so a crafted link can't send someone to another site after sign-in. */
export function isSafeNextPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

export function rememberNextPath(path: string) {
  if (!isSafeNextPath(path)) return;
  try {
    localStorage.setItem(NEXT_KEY, path);
  } catch {
    // Without storage, sign-in still works and lands on the home page.
  }
}

/** Returns and forgets the remembered path, or `/`. */
export function takeNextPath(): string {
  try {
    const next = localStorage.getItem(NEXT_KEY);
    localStorage.removeItem(NEXT_KEY);
    return isSafeNextPath(next) ? next : '/';
  } catch {
    return '/';
  }
}
