import { agentSessionSchema, hookSetupSchema } from '@race-control/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';

/** The team's most recent agent sessions. Polled until the live WebSocket feed arrives (Week 3). */
export function useSessions(teamId: string) {
  return useQuery({
    queryKey: ['teams', teamId, 'sessions'],
    queryFn: () => api(`/teams/${teamId}/sessions`, { schema: z.array(agentSessionSchema) }),
    refetchInterval: 10_000,
  });
}

/** Where agents send hooks, for building the settings snippet. */
export function useHookSetup() {
  return useQuery({
    queryKey: ['setup', 'hooks'],
    queryFn: () => api('/setup/hooks', { schema: hookSetupSchema }),
    staleTime: Infinity,
  });
}
