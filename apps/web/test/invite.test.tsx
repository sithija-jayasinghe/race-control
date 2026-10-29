import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { INVITE_TOKEN, PIT_CREW, fakeServer, renderApp } from './helpers.tsx';

/** Invite links carry the token in the URL fragment of the real page address. */
function openInvite(token?: string) {
  window.history.replaceState(null, '', token ? `/invite#token=${token}` : '/invite');
  return renderApp('/invite');
}

describe('invite page', () => {
  it('shows the team and joins it when you are signed in', async () => {
    const server = fakeServer({ signedIn: true });
    const { router } = openInvite(INVITE_TOKEN);

    expect(await screen.findByRole('heading', { name: 'Pit Crew' })).toBeInTheDocument();
    expect(screen.getByText(/as a developer/)).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Join Pit Crew' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${PIT_CREW.id}`));
    expect(server.callsTo('POST /invites/accept')).toHaveLength(1);
    expect(localStorage.getItem('rc-invite')).toBeNull();
  });

  it('keeps the invite through sign-in and brings you back to join', async () => {
    const server = fakeServer();
    const first = openInvite(INVITE_TOKEN);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to join' }));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/sign-in'));
    expect(localStorage.getItem('rc-invite')).toBe(INVITE_TOKEN);
    expect(localStorage.getItem('rc-next')).toBe('/invite');
    first.unmount();

    // The magic link opens (often in a new tab), signs in, and returns to /invite without the token in the URL.
    server.state.signedIn = true;
    const second = openInvite();

    await userEvent.click(await screen.findByRole('button', { name: 'Join Pit Crew' }));
    await waitFor(() => expect(second.router.state.location.pathname).toBe(`/t/${PIT_CREW.id}`));
  });

  it('explains an expired or revoked invite and forgets it', async () => {
    fakeServer({ signedIn: true });

    openInvite('revoked-token');

    expect(await screen.findByRole('heading', { name: 'Invite expired' })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('rc-invite')).toBeNull());
  });

  it('says so when there is no invite at all', async () => {
    fakeServer({ signedIn: true });

    openInvite();

    expect(await screen.findByRole('heading', { name: 'No invite here' })).toBeInTheDocument();
  });
});
