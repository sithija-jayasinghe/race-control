import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEAM, TEAMMATE, USER, agentSession, fakeServer, liveEvent, renderApp } from './helpers.tsx';

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

describe('once agents are on track', () => {
  it('shows them on the timing tower, counts them, and drops the setup steps once you are connected', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [
      agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email, userName: 'Nimal', repoName: 'web', toolCalls: 12 }),
      agentSession({ status: 'idle', toolCalls: 3 }),
      agentSession({ status: 'ended', userId: TEAMMATE.id, userEmail: TEAMMATE.email }),
    ]);
    openPitWall();

    const tower = await screen.findByRole('region', { name: 'Timing tower' });
    const rows = within(tower).getAllByRole('button');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'P1, Nimal, Claude Code, Working, 12 laps',
      'P2, lead@example.test, Claude Code, Idle, 3 laps',
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'Pit wall' })).toHaveClass('sr-only');
    expect(screen.queryByRole('list', { name: 'Connect your agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Connect your own agent/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Agents by status')).toBeInTheDocument();
  });

  it('offers to connect your own agent while only teammates are on track', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email })]);
    openPitWall();

    expect(await screen.findByRole('link', { name: /Connect your own agent/ })).toHaveAttribute(
      'href',
      `/t/${TEAM.id}/settings#connect`,
    );
  });

  it("opens a driver's live commands from the tower", async () => {
    const server = fakeServer({ signedIn: true });
    const session = agentSession({ userId: TEAMMATE.id, userEmail: TEAMMATE.email, userName: 'Nimal', repoName: 'api' });
    server.state.sessions.set(TEAM.id, [session]);
    server.state.events.set(TEAM.id, [
      liveEvent({ sessionId: session.id, type: 'PreToolUse', toolName: 'Edit', target: 'src/app.ts', summary: 'edit src/app.ts' }),
      liveEvent({ sessionId: session.id, type: 'PostToolUseFailure', toolName: 'Bash', target: 'pnpm test', summary: 'bash pnpm test · failed' }),
    ]);
    openPitWall();

    await userEvent.click(await screen.findByRole('button', { name: /Nimal/ }));

    const panel = screen.getByRole('complementary', { name: "Nimal's agent" });
    const commands = within(panel).getByRole('list', { name: 'Live commands' });
    expect(commands).toHaveTextContent('edit src/app.ts');
    expect(commands).toHaveTextContent('bash pnpm test · failed');
    expect(within(panel).getByText('Claude Code · api')).toBeInTheDocument();
  });

  it('goes back to the empty track when every session has ended', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [agentSession({ status: 'ended' })]);
    openPitWall();

    expect(await screen.findByRole('list', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();
  });
});
