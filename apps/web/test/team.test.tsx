import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEAM, TEAMMATE, USER, fakeServer, renderApp } from './helpers.tsx';

const openTeamPage = () => renderApp(`/t/${TEAM.id}/team`);
const memberRow = (name: string) => screen.getByText(name).closest('li')!;

async function openActions(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  return user;
}

describe('Team page members', () => {
  it('lists members with their roles, marking you', async () => {
    fakeServer({ signedIn: true });
    openTeamPage();

    expect(await screen.findByText('Nimal')).toBeInTheDocument();
    expect(within(memberRow('Nimal')).getByText('Dev')).toBeInTheDocument();
    expect(within(memberRow('Nimal')).getByText(TEAMMATE.email)).toBeInTheDocument();
    expect(within(memberRow(USER.email)).getByText('(you)')).toBeInTheDocument();
    expect(within(memberRow(USER.email)).getByText('Lead')).toBeInTheDocument();
    expect(screen.getByText('2 members')).toBeInTheDocument();
  });

  it('lets a lead change roles', async () => {
    const server = fakeServer({ signedIn: true });
    openTeamPage();
    const user = await openActions('Nimal');

    await user.click(screen.getByRole('menuitem', { name: 'Make lead' }));

    await waitFor(() => expect(within(memberRow('Nimal')).getByText('Lead')).toBeInTheDocument());
    expect(server.callsTo(`PATCH /teams/${TEAM.id}/members/${TEAMMATE.id}`)).toEqual([
      expect.objectContaining({ body: { role: 'lead' } }),
    ]);
  });

  it('explains why the last lead cannot step down', async () => {
    fakeServer({ signedIn: true });
    openTeamPage();
    const user = await openActions(USER.email);

    await user.click(screen.getByRole('menuitem', { name: 'Make developer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A team needs at least one lead');
  });

  it('asks before removing someone, and can be cancelled', async () => {
    const server = fakeServer({ signedIn: true });
    openTeamPage();
    const user = await openActions('Nimal');

    await user.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    expect(screen.getByText('Remove Nimal? Their tokens stop working.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(server.callsTo(`DELETE /teams/${TEAM.id}/members/${TEAMMATE.id}`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Actions for Nimal' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText('Nimal')).not.toBeInTheDocument());
    expect(screen.getByText('1 member')).toBeInTheDocument();
  });

  it('shows developers the team but only lets them leave', async () => {
    fakeServer({ signedIn: true, role: 'developer' });
    const { router } = openTeamPage();

    expect(await screen.findByText('Nimal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Nimal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invite links' })).not.toBeInTheDocument();

    const user = await openActions(USER.email);
    expect(screen.queryByRole('menuitem', { name: /Make/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Leave team' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/start'));
  });
});

describe('Team page invite links', () => {
  it('creates a link, shows it once with a copy button, and lists it', async () => {
    fakeServer({ signedIn: true });
    openTeamPage();
    // user-event provides a test clipboard on navigator.clipboard.
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: 'Lead' }));
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    const link = await screen.findByRole<HTMLInputElement>('textbox', { name: 'New invite link' });
    expect(link.value).toContain('/invite#token=');
    expect(screen.getByText(/join as a lead for 7 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(await navigator.clipboard.readText()).toBe(link.value);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Active invite links' })).toHaveTextContent('Lead');
  });

  it('revokes a link', async () => {
    fakeServer({ signedIn: true });
    openTeamPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    const list = await screen.findByRole('list', { name: 'Active invite links' });

    await user.click(within(list).getByRole('button', { name: /Revoke/ }));

    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active invite links' })).not.toBeInTheDocument());
  });
});
