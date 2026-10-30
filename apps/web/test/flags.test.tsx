import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { activeFlags, overlapKey, upsertFlag } from '../src/lib/flags.ts';
import { TEAM, TEAMMATE, agentSession, fakeServer, liveEvent, renderApp, yellowFlag } from './helpers.tsx';
import { FakeWebSocket } from './setup.ts';

const nimal = () => agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email, userName: 'Nimal' });
const kasun = () => agentSession({ userName: 'Kasun' });

/** Opens the live channel and waits for the re-fetch it triggers, so that can't replace what arrives next. */
async function connectedSocket(server: ReturnType<typeof fakeServer>) {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.latest();
  act(() => socket.open());
  await waitFor(() => expect(server.callsTo(`GET /teams/${TEAM.id}/flags`)).toHaveLength(2));
  await act(() => new Promise((r) => setTimeout(r, 0)));
  return socket;
}

describe('yellow flags on the Pit wall', () => {
  it('shows a Race Control banner and turns both drivers yellow', async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    server.state.flags.set(TEAM.id, [yellowFlag([a, b])]);
    renderApp(`/t/${TEAM.id}`);

    const banners = await screen.findByRole('region', { name: 'Race Control' });
    expect(within(banners).getByRole('status')).toHaveTextContent('Yellow flagRACE CONTROLNIM & KAS · buildflow-apisrc/auth/session.ts');
    const tower = screen.getByRole('region', { name: 'Timing tower' });
    const rows = within(tower).getAllByRole('button').map((r) => r.getAttribute('aria-label'));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row?.includes('Yellow flag'))).toBe(true);
  });

  it('raises a flag the moment it arrives on the live channel', async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    renderApp(`/t/${TEAM.id}`);
    await screen.findByRole('region', { name: 'Timing tower' });
    expect(screen.queryByRole('region', { name: 'Race Control' })).not.toBeInTheDocument();
    const socket = await connectedSocket(server);

    act(() => socket.receive({ type: 'flag', flag: yellowFlag([a, b], 'README.md') }));

    expect(await screen.findByText('README.md')).toBeInTheDocument();
  });

  it('hides a dismissed banner until someone new joins the overlap', async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    const c = agentSession({ userName: 'Amaya' });
    server.state.sessions.set(TEAM.id, [a, b, c]);
    server.state.flags.set(TEAM.id, [yellowFlag([a, b])]);
    renderApp(`/t/${TEAM.id}`);
    const socket = await connectedSocket(server);

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Race Control' })).not.toBeInTheDocument();

    // The same overlap again changes nothing; a third session on the file is news.
    act(() => socket.receive({ type: 'flag', flag: yellowFlag([b, a]) }));
    expect(screen.queryByRole('region', { name: 'Race Control' })).not.toBeInTheDocument();
    act(() => socket.receive({ type: 'flag', flag: yellowFlag([c, a, b]) }));
    expect(await screen.findByText(/AMA, NIM & KAS/)).toBeInTheDocument();
  });

  it('shows at most three banners, newest first', async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    server.state.flags.set(
      TEAM.id,
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((file) => yellowFlag([a, b], file)),
    );
    renderApp(`/t/${TEAM.id}`);

    const banners = await screen.findByRole('region', { name: 'Race Control' });
    expect(within(banners).getAllByRole('status')).toHaveLength(3);
    expect(within(banners).getByText('+2 more')).toBeInTheDocument();
  });
});

describe('yellow flags on the timeline', () => {
  it("marks this session's edits to the flagged file", async () => {
    const server = fakeServer({ signedIn: true });
    const [a, b] = [nimal(), kasun()];
    server.state.sessions.set(TEAM.id, [a, b]);
    server.state.flags.set(TEAM.id, [yellowFlag([a, b])]);
    server.state.events.set(TEAM.id, [
      liveEvent({ sessionId: a.id, toolName: 'Edit', target: 'src/auth/session.ts', summary: 'edit src/auth/session.ts' }),
      liveEvent({ sessionId: a.id, toolName: 'Read', target: 'src/auth/session.ts', summary: 'read src/auth/session.ts' }),
      liveEvent({ sessionId: a.id, toolName: 'Edit', target: 'src/app.ts', summary: 'edit src/app.ts' }),
    ]);
    renderApp(`/t/${TEAM.id}/sessions/${a.id}`);

    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await waitFor(() => expect(within(timeline).getAllByText('Yellow flag')).toHaveLength(1));
    expect(within(timeline).getByText('Yellow flag').closest('li')).toHaveTextContent('edit src/auth/session.ts');
  });
});

describe('flag helpers', () => {
  it('drops flags past their expiry', () => {
    const flag = yellowFlag([nimal(), kasun()]);
    expect(activeFlags([flag], Date.parse(flag.expiresAt) - 1)).toEqual([flag]);
    expect(activeFlags([flag], Date.parse(flag.expiresAt))).toEqual([]);
  });

  it('replaces a flag by file, newest first, and keys overlaps by who is on the file', () => {
    const [a, b] = [nimal(), kasun()];
    const older = yellowFlag([{ ...a, lastEventAt: '2026-10-30T10:00:00.000Z' }, b], 'x.ts');
    const newer = yellowFlag([{ ...a, lastEventAt: '2026-10-30T11:00:00.000Z' }, b], 'y.ts');
    const updated = yellowFlag([{ ...b, lastEventAt: '2026-10-30T12:00:00.000Z' }, a], 'x.ts');

    expect(upsertFlag(upsertFlag([older], newer), updated).map((f) => f.target)).toEqual(['x.ts', 'y.ts']);
    expect(overlapKey(updated)).toBe(overlapKey(older));
  });
});
