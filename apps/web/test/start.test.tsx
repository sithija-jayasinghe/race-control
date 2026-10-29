import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEAM, fakeServer, renderApp } from './helpers.tsx';

describe('creating a team', () => {
  it('makes you the lead and opens the new team', async () => {
    const server = fakeServer({ signedIn: true, teams: [] });
    const { router } = renderApp('/');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Build your team' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), '  Pit Crew ');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/t\/[\w-]+$/));
    expect(server.callsTo('POST /teams')).toEqual([{ method: 'POST', path: '/teams', body: { name: 'Pit Crew' } }]);
    expect(await screen.findByRole('button', { name: 'Team: Pit Crew' })).toBeInTheDocument();
  });

  it('asks for a name before creating anything', async () => {
    const server = fakeServer({ signedIn: true, teams: [] });
    renderApp('/start');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Create team' }));

    expect(screen.getByText('Give your team a name, up to 80 characters.')).toBeInTheDocument();
    expect(server.callsTo('POST /teams')).toHaveLength(0);
  });

  it('is reachable from the team switcher, with a way back', async () => {
    fakeServer({ signedIn: true });
    const { router } = renderApp(`/t/${TEAM.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Team: BuildFlow' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create a team' }));

    expect(await screen.findByRole('heading', { name: 'New team' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/start');
    expect(screen.getByRole('link', { name: 'Back to the pit wall' })).toHaveAttribute('href', '/');
  });
});
