import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEAM, fakeServer, renderApp } from './helpers.tsx';

describe('signed out', () => {
  it('sends you to sign in, and remembers where you were going', async () => {
    fakeServer();

    const { router } = renderApp(`/t/${TEAM.id}?view=tower`);

    expect(await screen.findByRole('heading', { name: 'Take your seat' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(localStorage.getItem('rc-next')).toBe(`/t/${TEAM.id}?view=tower`);
  });

  it('shows a way to retry when the server is unreachable', async () => {
    const server = fakeServer();
    server.on('GET /me', () => 'network-error');

    renderApp('/');

    expect(await screen.findByRole('heading', { name: "Can't reach Race Control" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('signed in', () => {
  it('opens your first team’s Pit wall', async () => {
    fakeServer({ signedIn: true });

    const { router } = renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Pit wall' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/t/${TEAM.id}`);
    expect(screen.getByText('BuildFlow')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Race Control' })).toBeInTheDocument();
  });

  it('shows the first-run page when you have no team', async () => {
    fakeServer({ signedIn: true, teams: [] });

    renderApp('/');

    expect(await screen.findByRole('heading', { name: "You're in" })).toBeInTheDocument();
    expect(screen.getByText('lead@example.test')).toBeInTheDocument();
  });

  it('lets someone without a team sign out', async () => {
    const server = fakeServer({ signedIn: true, teams: [] });
    const { router } = renderApp('/start');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Take your seat' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(server.callsTo('POST /auth/logout')).toHaveLength(1);
  });

  it('treats a team you are not in as a page that does not exist', async () => {
    fakeServer({ signedIn: true });

    renderApp('/t/99999999-9999-4999-8999-999999999999');

    expect(await screen.findByRole('heading', { name: 'Off track' })).toBeInTheDocument();
  });

  it('skips the sign-in page', async () => {
    fakeServer({ signedIn: true });

    const { router } = renderApp('/sign-in');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${TEAM.id}`));
  });

  it('shows the rail on desktop and the tab bar on phones, with the current page marked', async () => {
    fakeServer({ signedIn: true });
    renderApp(`/t/${TEAM.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Pit wall' });
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      const links = within(nav).getAllByRole('link');
      expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['Pit wall', 'Team', 'Settings']);
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        `/t/${TEAM.id}`,
        `/t/${TEAM.id}/team`,
        `/t/${TEAM.id}/settings`,
      ]);
      expect(within(nav).getByRole('link', { name: 'Pit wall' })).toHaveAttribute('aria-current', 'page');
    }
  });

  it('signs out from the account menu', async () => {
    const server = fakeServer({ signedIn: true });
    const { router } = renderApp(`/t/${TEAM.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByText('lead@example.test')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Take your seat' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(server.callsTo('POST /auth/logout')).toHaveLength(1);
  });
});
