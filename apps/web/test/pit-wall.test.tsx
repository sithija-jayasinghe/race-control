import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEAM, USER, fakeServer, renderApp } from './helpers.tsx';

const openPitWall = () => renderApp(`/t/${TEAM.id}`);

describe('empty track', () => {
  it('shows the steps to connect an agent, starting with a token', async () => {
    fakeServer({ signedIn: true });
    openPitWall();

    expect(await screen.findByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Connect your agent' })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(within(steps[0]!).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', `/t/${TEAM.id}/settings`);
    expect(within(steps[1]!).getByText(/Arrives with the next update/)).toBeInTheDocument();
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
