import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { approvalsKey } from '../src/lib/approvals.ts';
import { applyLiveMessage, eventsKey } from '../src/lib/live.ts';
import { TEAM, TEAMMATE, USER, approval, fakeServer, liveEvent, renderApp } from './helpers.tsx';
import { FakeWebSocket } from './setup.ts';

const pitLane = () => screen.findByRole('region', { name: 'Pit lane: Amaya wants to write' });

describe('the pit lane card', () => {
  it('shows the oldest waiting approval on the Pit wall, and a lead can approve it', async () => {
    const server = fakeServer({ signedIn: true });
    const first = approval();
    server.state.approvals.set(TEAM.id, [approval({ userName: 'Janith', requestedAt: new Date().toISOString() }), first]);
    renderApp(`/t/${TEAM.id}`);

    const card = await pitLane();
    expect(within(card).getByText('db/migrations/0042_users.sql')).toBeInTheDocument();
    expect(within(card).getByText('Migrations need a lead')).toBeInTheDocument();
    expect(within(card).getByRole('timer')).toHaveTextContent(/^3:5\d$/);
    expect(within(card).getByRole('link', { name: '+1 waiting' })).toHaveAttribute('href', `/t/${TEAM.id}/approvals`);
    expect(screen.getAllByRole('link', { name: 'Approvals, 2 waiting' })).toHaveLength(2);

    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));

    expect(server.callsTo(`POST /teams/${TEAM.id}/approvals/${first.id}/decision`)[0]?.body).toEqual({ decision: 'approve' });
    // Janith's request is next in line.
    expect(await screen.findByRole('region', { name: 'Pit lane: Janith wants to write' })).toBeInTheDocument();
  });

  it('shows the outcome for a moment once the last one is answered', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.approvals.set(TEAM.id, [approval()]);
    renderApp(`/t/${TEAM.id}`);

    await userEvent.click(within(await pitLane()).getByRole('button', { name: 'Deny' }));

    expect(await within(await pitLane()).findByRole('status')).toHaveTextContent('Denied. Amaya’s agent is told why.');
  });

  it('tells a lead who answered too late', async () => {
    const server = fakeServer({ signedIn: true });
    const late = approval();
    server.state.approvals.set(TEAM.id, [late]);
    server.on(`POST /teams/${TEAM.id}/approvals/${late.id}/decision`, () => ({ status: 409, body: { error: 'already_decided' } }));
    renderApp(`/t/${TEAM.id}`);

    await userEvent.click(within(await pitLane()).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Another lead answered first.');
  });

  it('shows developers that a lead decides', async () => {
    const server = fakeServer({ signedIn: true, role: 'developer' });
    server.state.approvals.set(TEAM.id, [approval()]);
    renderApp(`/t/${TEAM.id}`);

    const card = await pitLane();
    expect(within(card).getByText('Waiting for a lead')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('the Approvals page', () => {
  it('lists what is waiting, then the last day: GO, STOP and OUT', async () => {
    const server = fakeServer({ signedIn: true });
    const decidedAt = '2026-10-31T10:42:00.000Z';
    server.state.approvals.set(TEAM.id, [
      approval(),
      approval({ status: 'approved', userName: 'Kasun', toolName: 'Edit', target: 'db/migrations/0041.sql', decidedAt, decidedBy: { userId: USER.id, name: 'lead' } }),
      approval({ status: 'denied', userName: 'Ruwan', toolName: 'Bash', target: 'npm publish', decidedAt, decidedBy: { userId: TEAMMATE.id, name: 'Sam' } }),
      approval({ status: 'expired', target: 'db/migrations/0040.sql', decidedAt }),
    ]);
    renderApp(`/t/${TEAM.id}/approvals`);

    const waiting = await screen.findByRole('list', { name: 'Waiting' });
    expect(within(waiting).getByRole('link', { name: /Amaya · write/ })).toHaveAttribute('href', expect.stringMatching(/\/approvals\/.+/));
    expect(within(waiting).getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    const history = within(screen.getByRole('list', { name: 'Last 24 hours' })).getAllByRole('link');
    expect(history.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^GoKasun · edit db\/migrations\/0041\.sqlapproved by you · \d\d:\d\d$/),
      expect.stringMatching(/^StopRuwan · run npm publishdenied by Sam · \d\d:\d\d$/),
      expect.stringMatching(/^OutAmaya · write db\/migrations\/0040\.sqlno answer in 4 min · \d\d:\d\d$/),
    ]);
    expect(screen.getAllByRole('link', { name: 'Approvals, 1 waiting' })[0]).toHaveAttribute('aria-current', 'page');
  });

  it('says how agents end up here when nothing is waiting', async () => {
    fakeServer({ signedIn: true });
    renderApp(`/t/${TEAM.id}/approvals`);

    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'rule' })).toHaveAttribute('href', `/t/${TEAM.id}/rules`);
  });
});

describe('the phone approval screen', () => {
  it('puts Approve within thumb reach and shows the answer', async () => {
    const server = fakeServer({ signedIn: true });
    const waiting = approval();
    server.state.approvals.set(TEAM.id, [waiting]);
    renderApp(`/t/${TEAM.id}/approvals/${waiting.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Pit lane' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^3:5\d$/);
    expect(screen.getAllByRole('button', { name: /^(Approve|Deny)$/ }).map((b) => b.textContent)).toEqual(['Approve', 'Deny']);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Approved\. Amaya’s agent carries on\.approved by you/);
  });

  it("is off track for an approval that isn't there", async () => {
    fakeServer({ signedIn: true });
    renderApp(`/t/${TEAM.id}/approvals/55555555-5555-4555-8555-999999999999`);

    expect(await screen.findByRole('heading', { name: 'Off track' })).toBeInTheDocument();
  });
});

describe('live approvals', () => {
  it('adds new approvals and updates decided ones', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(approvalsKey(TEAM.id), []);
    const held = approval();

    applyLiveMessage(queryClient, TEAM.id, { type: 'approval', approval: held });
    applyLiveMessage(queryClient, TEAM.id, { type: 'approval', approval: { ...held, status: 'approved' } });

    expect(queryClient.getQueryData(approvalsKey(TEAM.id))).toEqual([{ ...held, status: 'approved' }]);
  });

  it('replaces a held event with its outcome instead of adding it twice', () => {
    const queryClient = new QueryClient();
    const event = liveEvent({ decision: 'pending' });
    queryClient.setQueryData(eventsKey(TEAM.id), [event]);

    applyLiveMessage(queryClient, TEAM.id, { type: 'event', event: { ...event, decision: 'allow' } });

    expect(queryClient.getQueryData(eventsKey(TEAM.id))).toEqual([{ ...event, decision: 'allow' }]);
  });

  it('shows a request the moment it arrives on the live channel', async () => {
    fakeServer({ signedIn: true });
    renderApp(`/t/${TEAM.id}`);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    const socket = FakeWebSocket.latest();
    act(() => socket.open());
    await screen.findByRole('heading', { level: 1, name: 'No cars on track' });
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Approvals' })).toHaveLength(2));

    act(() => socket.receive({ type: 'approval', approval: approval() }));

    expect(await pitLane()).toBeInTheDocument();
  });
});
