import {
  liveMessageSchema,
  type AgentSession,
  type LiveEvent,
  type LiveMessage,
  type TeamRadio,
  type YellowFlag,
} from '@race-control/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { flagsKey, upsertFlag } from '@/lib/flags';
import { addRadio, radioKey } from '@/lib/radio';
import { sessionsKey } from '@/lib/sessions';

export type LiveStatus = 'connecting' | 'live' | 'offline';

export const eventsKey = (teamId: string) => ['teams', teamId, 'events'] as const;
// useTeamEvents (lib/sessions.ts) uses the same key, so live events land in the same list.

const MAX_SESSIONS = 50;
const MAX_EVENTS = 200;
const MAX_RETRY_MS = 30_000;

function liveUrl(teamId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/teams/${teamId}/live`;
}

/** Folds one live message into the cached sessions, feed, flags and Team Radio. */
export function applyLiveMessage(queryClient: QueryClient, teamId: string, message: LiveMessage) {
  if (message.type === 'session') {
    queryClient.setQueryData<AgentSession[]>(sessionsKey(teamId), (old = []) =>
      [message.session, ...old.filter((s) => s.id !== message.session.id)]
        .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
        .slice(0, MAX_SESSIONS),
    );
  } else if (message.type === 'event') {
    queryClient.setQueryData<LiveEvent[]>(eventsKey(teamId), (old = []) => [...old, message.event].slice(-MAX_EVENTS));
  } else if (message.type === 'flag') {
    queryClient.setQueryData<YellowFlag[]>(flagsKey(teamId), (old = []) => upsertFlag(old, message.flag));
  } else if (message.type === 'radio') {
    queryClient.setQueryData<TeamRadio[]>(radioKey(teamId), (old = []) => addRadio(old, message.radio));
  }
}

/**
 * Keeps a WebSocket open to the team's live channel and folds every message into the query cache.
 * Reconnects with backoff (1 s, 2 s, 4 s… up to 30 s) and re-fetches sessions and flags after reconnecting,
 * so nothing that happened while offline is missed.
 */
export function useLiveTeam(teamId: string): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      socket = new WebSocket(liveUrl(teamId));
      socket.onopen = () => {
        attempt = 0;
        setStatus('live');
        void queryClient.invalidateQueries({ queryKey: sessionsKey(teamId) });
        void queryClient.invalidateQueries({ queryKey: flagsKey(teamId) });
      };
      socket.onmessage = (event: MessageEvent) => {
        let data: unknown;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const parsed = liveMessageSchema.safeParse(data);
        if (parsed.success) applyLiveMessage(queryClient, teamId, parsed.data);
      };
      socket.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        retryTimer = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt++));
      };
    };

    setStatus('connecting');
    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [teamId, queryClient]);

  return status;
}
