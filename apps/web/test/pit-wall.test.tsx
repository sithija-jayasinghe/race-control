import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEAM, TEAMMATE, USER, agentSession, fakeServer, renderApp } from './helpers.tsx';

const openPitWall = () => renderApp(`/t/${TEAM.id}`);

describe('empty track', () => {
  it('shows the steps to connect an agent, starting with a token', async () => {
    fakeServer({ signedIn: true });
    openPitWall();

    expect(await screen.findByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Connect your agent' })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(within(steps[0]!).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', `/t/${TEAM.id}/settings`);
    expect(within(steps[1]!).getByRole('link', { name: 'Connect Claude Code' })).toHaveAttribute(
      'href',
      `/t/${TEAM.id}/settings#connect`,
    );
  });

  it('ticks off the first step once you have a token', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.tokens.set(TEAM.id, [
      { id: '66666666-6666-4666-8666-000000000001', label: 'Laptop', userId: USER.id, userEmail: USER.email, createdAt: new Date().toISOString(), lastUsedAt: null },
    ]);
    openPitWall();

    const firstStep = (await screen.findByRole('list', { name: 'Connect your agent' })).querySelector('li')!;
    expect(await within(firstStep).findByLabelText('Done')).toBeInTheDocument();
  });

  it('points leads to inviting their team, but not developers', async () => {
    fakeServer({ signedIn: true });
    const lead = openPitWall();
    expect(await screen.findByRole('link', { name: 'Invite your team' })).toHaveAttribute('href', `/t/${TEAM.id}/team`);
    lead.unmount();

    fakeServer({ signedIn: true, role: 'developer' });
    openPitWall();
    await screen.findByRole('heading', { level: 1, name: 'No cars on track' });
    expect(screen.queryByRole('link', { name: 'Invite your team' })).not.toBeInTheDocument();
  });
});

describe('demo race', () => {
  it('shows sample drivers, clearly marked, and returns to the empty track', async () => {
    fakeServer({ signedIn: true });
    const { router } = openPitWall();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Watch a demo race' }));

    expect(router.state.location.search).toBe('?demo=1');
    expect(screen.getByRole('region', { name: 'Timing tower' })).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByLabelText('Agents by status')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exit demo' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();
  });
});

describe('once agents report in', () => {
  it('counts cars on track, lists sessions, and drops the checklist once you are connected', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [
      agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email, userName: 'Nimal', repoName: 'web', lastAction: 'bash pnpm test' }),
      agentSession({ status: 'idle', lastAction: 'finished responding' }),
      agentSession({ status: 'ended', userId: TEAMMATE.id, userEmail: TEAMMATE.email, lastAction: 'session ended (other)' }),
    ]);
    openPitWall();

    expect(await screen.findByRole('heading', { level: 1, name: '1 car on track' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Connect your agent' })).not.toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Sessions' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Working');
    expect(rows[0]).toHaveTextContent('Nimal · web');
    expect(rows[0]).toHaveTextContent('bash pnpm test');
    expect(rows[1]).toHaveTextContent('Idle');
    expect(rows[2]).toHaveTextContent('Ended');
  });

  it("keeps showing you the steps while only teammates are connected", async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email })]);
    openPitWall();

    expect(await screen.findByRole('list', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Connect your agent' })).toBeInTheDocument();
  });
});
