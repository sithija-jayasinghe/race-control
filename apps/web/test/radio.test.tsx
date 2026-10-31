import type { AgentSession, LiveEvent, TeamRadio } from '@race-control/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { radioNames, radioQuote } from '../src/lib/radio.ts';
import { TEAM, TEAMMATE, agentSession, fakeServer, liveEvent, renderApp } from './helpers.tsx';
import { FakeWebSocket } from './setup.ts';

const nimal = () => agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email, userName: 'Nimal' });
const kasun = () => agentSession({ userName: 'Kasun' });

/** Kasun's agent heard that Nimal edited the file `minutesAgo` before. */
function teamRadio(heard: AgentSession, about: AgentSession, eventId: string, minutesAgo = 2, at = new Date()): TeamRadio {
  return {
    eventId,
    sessionId: heard.id,
    repoName: 'buildflow-api',
    target: 'src/auth/session.ts',
    about: [
      {
        sessionId: about.id,
        userId: about.userId,
        userEmail: about.userEmail,
        userName: about.userName,
        agent: about.agent,
        lastAt: new Date(at.getTime() - minutesAgo * 60_000).toISOString(),
      },
    ],
    createdAt: at.toISOString(),
  };
}

async function connectedSocket() {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.latest();
  act(() => socket.open());
  return socket;
}

describe('Team Radio on the Pit wall', () => {
  it('shows the heads-up Race Control sent, to the driver who heard it', async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    renderApp(`/t/${TEAM.id}`);
    await screen.findByRole('region', { name: 'Timing tower' });
    const socket = await connectedSocket();

    act(() => socket.receive({ type: 'radio', radio: teamRadio(b, a, liveEvent().id) }));

    const card = await screen.findByText(/RC → KAS/);
    expect(card.closest('[role="status"]')).toHaveTextContent('“Nimal edited src/auth/session.ts 2 min ago”');
  });

  it("doesn't replay an old heads-up", async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    renderApp(`/t/${TEAM.id}`);
    await screen.findByRole('region', { name: 'Timing tower' });
    const socket = await connectedSocket();

    act(() => socket.receive({ type: 'radio', radio: teamRadio(b, a, liveEvent().id, 2, new Date(Date.now() - 20_000)) }));
    await act(() => new Promise((r) => setTimeout(r, 0)));

    expect(screen.queryByText(/RC → KAS/)).not.toBeInTheDocument();
  });
});

describe('Team Radio on the timeline', () => {
  it('tags the step that carried a heads-up, whether loaded or live', async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    const loaded = { ...liveEvent({ sessionId: b.id, summary: 'read src/auth/session.ts' }), radio: ['Nimal'] } as LiveEvent;
    server.state.events.set(TEAM.id, [loaded, liveEvent({ sessionId: b.id, summary: 'read src/app.ts' })]);
    renderApp(`/t/${TEAM.id}/sessions/${b.id}`);

    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    expect(within(timeline).getByText('Team radio').closest('li')).toHaveTextContent(
      'read src/auth/session.tsTeam radioHeads-up: Nimal edited this file recently',
    );

    const socket = await connectedSocket();
    const live = liveEvent({ sessionId: b.id, toolName: 'Edit', summary: 'edit src/auth/session.ts' });
    act(() => {
      socket.receive({ type: 'event', event: live });
      socket.receive({ type: 'radio', radio: teamRadio(b, a, live.id) });
    });

    await waitFor(() => expect(within(timeline).getAllByText('Team radio')).toHaveLength(2));
    expect(within(timeline).getAllByText('Team radio')[1]!.closest('li')).toHaveTextContent('edit src/auth/session.ts');
  });
});

describe('radio helpers', () => {
  it('names one, two or more people briefly', () => {
    expect(radioNames(['Nimal'])).toBe('Nimal');
    expect(radioNames(['Nimal', 'Kasun'])).toBe('Nimal & Kasun');
    expect(radioNames(['Nimal', 'Kasun', 'Amaya'])).toBe('Nimal +2');
  });

  it('says "just now" for an edit less than a minute before', () => {
    expect(radioQuote(teamRadio(kasun(), nimal(), liveEvent().id, 0.5))).toBe('Nimal edited src/auth/session.ts just now');
  });
});
