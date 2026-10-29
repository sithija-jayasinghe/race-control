import { createdDevTokenSchema, devTokenSchema } from '@race-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';

const tokensKey = (teamId: string) => ['teams', teamId, 'tokens'] as const;

/** Your tokens in this team; for leads, everyone's. The token values themselves are never listed. */
export function useTokens(teamId: string) {
  return useQuery({
    queryKey: tokensKey(teamId),
    queryFn: () => api(`/teams/${teamId}/tokens`, { schema: z.array(devTokenSchema) }),
  });
}

/** Creates a token for you. The response is the only time the token is ever shown. */
export function useCreateToken(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label: string) =>
      api(`/teams/${teamId}/tokens`, { method: 'POST', body: { label }, schema: createdDevTokenSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey(teamId) }),
  });
}

export function useRevokeToken(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => api(`/teams/${teamId}/tokens/${tokenId}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: tokensKey(teamId) }),
  });
}
