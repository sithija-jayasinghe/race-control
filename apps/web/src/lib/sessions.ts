import { agentSessionSchema, hookSetupSchema, liveEventSchema, sessionTimelineSchema } from '@race-control/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';

export const sessionsKey = (teamId: string) => ['teams', teamId, 'sessions'] as const;

/**
 * The team's most recent agent sessions. The live channel keeps them current; `poll` refreshes every
 * 10 s instead, for while that channel is down.
 */
export function useSessions(teamId: string, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: sessionsKey(teamId),
    queryFn: () => api(`/teams/${teamId}/sessions`, { schema: z.array(agentSessionSchema) }),
    refetchInterval: options.poll === false ? false : 10_000,
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

/** The team's recent events (oldest first). The live channel appends new ones to the same cache. */
export function useTeamEvents(teamId: string) {
  return useQuery({
    queryKey: ['teams', teamId, 'events'],
    queryFn: () => api(`/teams/${teamId}/events`, { schema: z.array(liveEventSchema) }),
    staleTime: Infinity,
  });
}

/** One session and its steps. New steps arrive through the live channel (see the timeline page). */
export function useSessionTimeline(teamId: string, sessionId: string) {
  return useQuery({
    queryKey: ['teams', teamId, 'sessions', sessionId],
    queryFn: () => api(`/teams/${teamId}/sessions/${sessionId}`, { schema: sessionTimelineSchema }),
    retry: false,
  });
}
