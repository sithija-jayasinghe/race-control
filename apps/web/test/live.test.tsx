import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyLiveMessage, eventsKey } from '../src/lib/live.ts';
import { sessionsKey } from '../src/lib/sessions.ts';
import { TEAM, TEAMMATE, agentSession, fakeServer, renderApp } from './helpers.tsx';
import { FakeWebSocket } from './setup.ts';

const openPitWall = () => renderApp(`/t/${TEAM.id}`);

async function connectedSocket() {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.latest();
  act(() => socket.open());
  return socket;
}

describe('live channel', () => {
  it("connects to the team's channel and shows LIVE", async () => {
    fakeServer({ signedIn: true });
    openPitWall();

    const socket = await connectedSocket();

    expect(socket.url).toBe(`ws://${window.location.host}/api/teams/${TEAM.id}/live`);
    expect(await screen.findByText('Live')).toBeInTheDocument();
  });

  it('puts new sessions on the Pit wall as they arrive', async () => {
    fakeServer({ signedIn: true });
    openPitWall();
    const socket = await connectedSocket();
    expect(await screen.findByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();

    act(() =>
      socket.receive({
        type: 'session',
        session: agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email, userName: 'Nimal', lastAction: 'edit src/app.ts' }),
      }),
    );

    const tower = await screen.findByRole('region', { name: 'Timing tower' });
    expect(within(tower).getByRole('button', { name: /P1, Nimal/ })).toBeInTheDocument();
  });

  it('ignores messages it does not understand', async () => {
    fakeServer({ signedIn: true });
    openPitWall();
    const socket = await connectedSocket();

    act(() => {
      socket.receive('not json');
      socket.receive({ type: 'session', session: { id: 'bad' } });
      socket.receive({ type: 'something-new' });
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();
  });

  it('says it is reconnecting when the connection drops, then reconnects', async () => {
    fakeServer({ signedIn: true });
    openPitWall();
    const first = await connectedSocket();

    act(() => first.close());

    expect(await screen.findByText('Reconnecting')).toBeInTheDocument();
    expect(screen.getByText('updates every 10 s')).toBeInTheDocument();
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2), { timeout: 2000 });
  });

  it('closes the connection when you leave the team', async () => {
    fakeServer({ signedIn: true });
    const { unmount } = openPitWall();
    const socket = await connectedSocket();

    unmount();

    expect(socket.closed).toBe(true);
  });
});

describe('applyLiveMessage', () => {
  it('updates a session in place and keeps the newest first', () => {
    const client = new QueryClient();
    const older = agentSession({ lastEventAt: '2026-10-30T10:00:00.000Z' });
    const other = agentSession({ lastEventAt: '2026-10-30T10:05:00.000Z' });
    client.setQueryData(sessionsKey(TEAM.id), [other, older]);

    applyLiveMessage(client, TEAM.id, {
      type: 'session',
      session: { ...older, status: 'idle', lastEventAt: '2026-10-30T10:10:00.000Z' },
    });

    const sessions = client.getQueryData<Array<{ id: string; status: string }>>(sessionsKey(TEAM.id))!;
    expect(sessions.map((s) => s.id)).toEqual([older.id, other.id]);
    expect(sessions[0]!.status).toBe('idle');
  });

  it('keeps the latest 200 events for the feed', () => {
    const client = new QueryClient();
    for (let i = 0; i < 205; i++) {
      applyLiveMessage(client, TEAM.id, {
        type: 'event',
        event: {
          id: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`,
          sessionId: '88888888-8888-4888-8888-888888888888',
          type: 'PreToolUse',
          toolName: 'Read',
          target: `file${i}.ts`,
          summary: `read file${i}.ts`,
          decision: 'none',
          createdAt: new Date().toISOString(),
        },
      });
    }

    const events = client.getQueryData<Array<{ target: string }>>(eventsKey(TEAM.id))!;
    expect(events).toHaveLength(200);
    expect(events.at(-1)!.target).toBe('file204.ts');
  });
});
