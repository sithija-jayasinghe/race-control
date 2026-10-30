import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { timeAgo } from '../src/lib/time.ts';
import { TEAM, TEAMMATE, USER, agentSession, fakeServer, renderApp } from './helpers.tsx';

const openSettings = () => renderApp(`/t/${TEAM.id}/settings`);

async function createToken(label: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Token name' }), label);
  await user.click(screen.getByRole('button', { name: 'Create token' }));
  return user;
}

describe('agent tokens', () => {
  it('shows a new token once, with copy buttons for the token and the export line', async () => {
    const server = fakeServer({ signedIn: true });
    openSettings();

    const user = await createToken('  Work laptop ');

    const token = await screen.findByRole<HTMLInputElement>('textbox', { name: 'New token' });
    expect(token.value).toMatch(/^rc_/);
    expect(screen.getByText(/it won't be shown again/)).toBeInTheDocument();
    expect(server.callsTo(`POST /teams/${TEAM.id}/tokens`)).toEqual([
      expect.objectContaining({ body: { label: 'Work laptop' } }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Copy export line' }));
    expect(await navigator.clipboard.readText()).toBe(`export RACE_CONTROL_TOKEN=${token.value}`);

    const list = await screen.findByRole('list', { name: 'Active tokens' });
    expect(within(list).getByText('Work laptop')).toBeInTheDocument();
    expect(within(list).getByText(/never used/)).toBeInTheDocument();
    expect(list).not.toHaveTextContent(token.value);
  });

  it('asks for a name before creating anything', async () => {
    const server = fakeServer({ signedIn: true });
    openSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Create token' }));

    expect(screen.getByText(/Name the token after where it runs/)).toBeInTheDocument();
    expect(server.callsTo(`POST /teams/${TEAM.id}/tokens`)).toHaveLength(0);
  });

  it('explains the token limit', async () => {
    const server = fakeServer({ signedIn: true });
    server.on(`POST /teams/${TEAM.id}/tokens`, () => ({ status: 409, body: { error: 'too_many_tokens' } }));
    openSettings();

    await createToken('One more');

    expect(await screen.findByRole('alert')).toHaveTextContent('You have 10 active tokens');
  });

  it('revokes a token after confirming', async () => {
    fakeServer({ signedIn: true });
    openSettings();
    const user = await createToken('Old laptop');
    const list = await screen.findByRole('list', { name: 'Active tokens' });

    await user.click(within(list).getByRole('button', { name: 'Revoke Old laptop' }));
    expect(screen.getByText(/Agents using it stop reporting/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active tokens' })).not.toBeInTheDocument());
  });

  it("shows whose token it is when a lead sees a teammate's", async () => {
    const server = fakeServer({ signedIn: true });
    server.state.tokens.set(TEAM.id, [
      { id: '66666666-6666-4666-8666-0000000000a1', label: 'Nimal desktop', userId: TEAMMATE.id, userEmail: TEAMMATE.email, createdAt: new Date().toISOString(), lastUsedAt: null },
      { id: '66666666-6666-4666-8666-0000000000a2', label: 'My laptop', userId: USER.id, userEmail: USER.email, createdAt: new Date().toISOString(), lastUsedAt: null },
    ]);
    openSettings();

    const list = await screen.findByRole('list', { name: 'Active tokens' });
    expect(within(list).getByText('Nimal desktop').parentElement).toHaveTextContent(TEAMMATE.email);
    expect(within(list).getByText('My laptop').parentElement).not.toHaveTextContent(USER.email);
    expect(screen.getByRole('heading', { name: 'Agent tokens' })).toBeInTheDocument();
  });
});

describe('appearance', () => {
  it('switches the theme', async () => {
    fakeServer({ signedIn: true });
    openSettings();

    await userEvent.click(await screen.findByRole('radio', { name: 'Light' }));

    expect(document.documentElement).not.toHaveClass('dark');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  it.each([
    ['2026-10-29T11:59:30Z', 'just now'],
    ['2026-10-29T11:55:00Z', '5 min. ago'],
    ['2026-10-29T09:00:00Z', '3 hr. ago'],
    ['2026-10-28T12:00:00Z', 'yesterday'],
    ['2026-10-19T12:00:00Z', '10 days ago'],
  ])('%s → %s', (iso, text) => {
    expect(timeAgo(iso, now)).toBe(text);
  });
});

describe('connect Claude Code', () => {
  it('shows hook settings for this server that read the token from the environment', async () => {
    fakeServer({ signedIn: true });
    openSettings();
    const user = userEvent.setup();

    const snippet = await screen.findByLabelText('Hook settings');
    expect(snippet).toHaveTextContent('"url": "http://api.test/hooks/PreToolUse"');
    expect(snippet).toHaveTextContent('"Authorization": "Bearer $RACE_CONTROL_TOKEN"');
    expect(screen.getByText('.claude/settings.json')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'All my projects' }));
    expect(screen.getByText('~/.claude/settings.json')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy hook settings' }));
    const copied = JSON.parse(await navigator.clipboard.readText()) as { hooks: Record<string, unknown> };
    expect(Object.keys(copied.hooks)).toContain('SessionEnd');
  });

  it('confirms the connection once your agent has reported', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.sessions.set(TEAM.id, [agentSession()]);
    openSettings();

    expect(await screen.findByText(/Connected. Your last activity arrived/)).toBeInTheDocument();
  });
});
