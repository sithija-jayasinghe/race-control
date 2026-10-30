import { yellowFlagSchema, type YellowFlag } from '@race-control/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';

export const flagsKey = (teamId: string) => ['teams', teamId, 'flags'] as const;

/** The team's yellow flags. The live channel adds and extends them; `poll` refreshes while it's down. */
export function useFlags(teamId: string, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: flagsKey(teamId),
    queryFn: () => api(`/teams/${teamId}/flags`, { schema: z.array(yellowFlagSchema) }),
    refetchInterval: options.poll ? 10_000 : false,
  });
}

/** Flags still flying: each clears by itself once its file has been quiet long enough. */
export function activeFlags(flags: YellowFlag[], now: number): YellowFlag[] {
  return flags.filter((f) => Date.parse(f.expiresAt) > now);
}

/** Identifies one overlap: the file plus who's on it. A new session joining is a new overlap. */
export function overlapKey(flag: YellowFlag): string {
  return `${flag.id}|${flag.drivers
    .map((d) => d.sessionId)
    .sort()
    .join(',')}`;
}

/** Adds or replaces a flag in a list, newest first. */
export function upsertFlag(flags: YellowFlag[], flag: YellowFlag): YellowFlag[] {
  return [flag, ...flags.filter((f) => f.id !== flag.id)].sort((a, b) =>
    b.drivers[0]!.lastAt.localeCompare(a.drivers[0]!.lastAt),
  );
}
