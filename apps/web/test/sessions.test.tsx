import type { TimelineEvent } from '@race-control/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mergeLive, timelineSteps } from '../src/pages/session.tsx';
import { duration } from '../src/pages/sessions.tsx';
import { TEAM, TEAMMATE, agentSession, fakeServer, liveEvent, renderApp } from './helpers.tsx';
import { FakeWebSocket } from './setup.ts';

const step = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({ ...liveEvent(overrides), detail: null, radio: null, ...overrides });

describe('Sessions page', () => {
  it('lists sessions and filters them by status', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [
      agentSession({ userName: 'Nimal', userId: TEAMMATE.id, status: 'active', toolCalls: 12 }),
      agentSession({ userName: 'Kasun', status: 'ended', repoName: 'buildflow-web' }),
    ]);
    renderApp(`/t/${TEAM.id}/sessions`);

    const list = await screen.findByRole('list', { name: 'Sessions' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).getByText('12 laps · 0m')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Ended' }));

    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByRole('link')).toHaveTextContent('Kasun · buildflow-web');
    await userEvent.click(screen.getByRole('radio', { name: 'Idle' }));
    expect(screen.getByText('None right now.')).toBeInTheDocument();
  });

  it('invites people to connect an agent when there are no sessions', async () => {
    fakeServer({ signedIn: true });
    renderApp(`/t/${TEAM.id}/sessions`);

    expect(await screen.findByText(/No sessions yet/)).toBeInTheDocument();
  });

  it('opens a session timeline from the list', async () => {
    const server = fakeServer({ signedIn: true });
    const session = agentSession({ userName: 'Nimal' });
    server.state.sessions.set(TEAM.id, [session]);
    const { router } = renderApp(`/t/${TEAM.id}/sessions`);

    await userEvent.click(await screen.findByRole('link', { name: /Nimal/ }));

    expect(router.state.location.pathname).toBe(`/t/${TEAM.id}/sessions/${session.id}`);
    expect(await screen.findByRole('list', { name: 'Timeline' })).toBeInTheDocument();
  });
});

describe('Session timeline', () => {
  it('shows the session and its steps, with failures in their own words', async () => {
    const server = fakeServer({ signedIn: true });
    const session = agentSession({ userName: 'Nimal', toolCalls: 2, repoName: 'buildflow-api' });
    server.state.sessions.set(TEAM.id, [session]);
    server.state.events.set(TEAM.id, [
      liveEvent({ sessionId: session.id, type: 'SessionStart', toolName: null, summary: 'session startup', createdAt: '2026-10-30T10:00:00Z' }),
      liveEvent({ sessionId: session.id, toolName: 'Edit', summary: 'edit src/app.ts', createdAt: '2026-10-30T10:00:01Z' }),
      liveEvent({ sessionId: session.id, type: 'PostToolUse', toolName: 'Edit', summary: 'edit src/app.ts', createdAt: '2026-10-30T10:00:02Z' }),
      liveEvent({ sessionId: session.id, type: 'PostToolUseFailure', toolName: 'Bash', summary: 'bash pnpm build · failed', createdAt: '2026-10-30T10:00:03Z' }),
      liveEvent({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', summary: 'someone else', createdAt: '2026-10-30T10:00:04Z' }),
    ]);
    renderApp(`/t/${TEAM.id}/sessions/${session.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Nimal' })).toBeInTheDocument();
    expect(screen.getByText(/Claude Code · buildflow-api · started .* · 2 tool calls · 1 failed/)).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent?.replace(/^\d\d:\d\d:\d\d/, ''))).toEqual([
      'Session started',
      'edit src/app.ts',
      'bash pnpm build · failed',
    ]);
  });

  it('grows as new steps arrive on the live channel', async () => {
    const server = fakeServer({ signedIn: true });
    const session = agentSession({ userName: 'Nimal' });
    server.state.sessions.set(TEAM.id, [session]);
    renderApp(`/t/${TEAM.id}/sessions/${session.id}`);
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    const socket = FakeWebSocket.latest();
    act(() => socket.open());

    act(() => socket.receive({ type: 'event', event: liveEvent({ sessionId: session.id, summary: 'read README.md' }) }));
    act(() => socket.receive({ type: 'event', event: liveEvent({ summary: 'another session' }) }));

    expect(await within(timeline).findByText('read README.md')).toBeInTheDocument();
    expect(within(timeline).queryByText('another session')).not.toBeInTheDocument();
  });

  it("says so when the session isn't there (or belongs to another team)", async () => {
    fakeServer({ signedIn: true });
    renderApp(`/t/${TEAM.id}/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Session not found' })).toBeInTheDocument();
  });
});

describe('timeline helpers', () => {
  it('formats durations', () => {
    expect(duration('2026-10-30T10:00:00Z', '2026-10-30T10:04:20Z')).toBe('4m');
    expect(duration('2026-10-30T10:00:00Z', '2026-10-30T11:12:00Z')).toBe('1h 12m');
  });

  it('merges live steps once, in time order, and hides successful results', () => {
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const first = step({ sessionId, createdAt: '2026-10-30T10:00:00Z' });
    const result = step({ sessionId, type: 'PostToolUse', createdAt: '2026-10-30T10:00:01Z' });
    const later = liveEvent({ sessionId, createdAt: '2026-10-30T10:00:02Z' });

    const merged = timelineSteps(mergeLive([first, result], [later, first, liveEvent()], sessionId));

    expect(merged.map((e) => e.id)).toEqual([first.id, later.id]);
  });
});
