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
import { approvalsKey, storeApproval } from '@/lib/approvals';
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

/** Folds one live message into the cached sessions, feed, flags, Team Radio and approvals. */
export function applyLiveMessage(queryClient: QueryClient, teamId: string, message: LiveMessage) {
  if (message.type === 'session') {
    queryClient.setQueryData<AgentSession[]>(sessionsKey(teamId), (old = []) =>
      [message.session, ...old.filter((s) => s.id !== message.session.id)]
        .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
        .slice(0, MAX_SESSIONS),
    );
  } else if (message.type === 'event') {
    // A held event comes again once a lead decides, with its new outcome: replace it in place.
    queryClient.setQueryData<LiveEvent[]>(eventsKey(teamId), (old = []) =>
      old.some((e) => e.id === message.event.id)
        ? old.map((e) => (e.id === message.event.id ? message.event : e))
        : [...old, message.event].slice(-MAX_EVENTS),
    );
  } else if (message.type === 'flag') {
    queryClient.setQueryData<YellowFlag[]>(flagsKey(teamId), (old = []) => upsertFlag(old, message.flag));
  } else if (message.type === 'radio') {
    queryClient.setQueryData<TeamRadio[]>(radioKey(teamId), (old = []) => addRadio(old, message.radio));
  } else if (message.type === 'approval') {
    storeApproval(queryClient, teamId, message.approval);
    // The session's timeline says who decided; fetch it again so it does.
    if (message.approval.status !== 'pending') {
      void queryClient.invalidateQueries({ queryKey: [...sessionsKey(teamId), message.approval.sessionId], exact: true });
    }
  }
}

/**
 * Keeps a WebSocket open to the team's live channel and folds every message into the query cache.
 * Reconnects with backoff (1 s, 2 s, 4 s… up to 30 s) and re-fetches sessions, flags and approvals after reconnecting,
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
        void queryClient.invalidateQueries({ queryKey: approvalsKey(teamId) });
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
