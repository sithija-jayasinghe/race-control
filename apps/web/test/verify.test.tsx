import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isSafeNextPath, rememberNextPath, takeNextPath } from '../src/lib/auth.ts';
import { TEAM, fakeServer, renderApp } from './helpers.tsx';

/** The magic link puts the token in the URL fragment of the real page address. */
function openLink(token?: string) {
  window.history.replaceState(null, '', token ? `/auth/verify#token=${token}` : '/auth/verify');
  return renderApp('/auth/verify');
}

describe('magic link landing page', () => {
  it('signs you in once, removes the token from the address bar, and continues where you were going', async () => {
    const server = fakeServer();
    localStorage.setItem('rc-next', `/t/${TEAM.id}`);

    const { router } = openLink('good-token');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${TEAM.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'No cars on track' })).toBeInTheDocument();
    // StrictMode runs effects twice; the single-use token must still be sent only once.
    expect(server.callsTo('POST /auth/verify')).toEqual([
      { method: 'POST', path: '/auth/verify', body: { token: 'good-token' } },
    ]);
    expect(window.location.hash).toBe('');
    expect(localStorage.getItem('rc-next')).toBeNull();
  });

  it('explains an expired or used link and offers a new one', async () => {
    fakeServer();

    openLink('used-token');

    expect(await screen.findByRole('heading', { name: "Link didn't work" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/sign-in');
  });

  it('does nothing with a link that has no token', async () => {
    const server = fakeServer();

    openLink();

    expect(await screen.findByRole('heading', { name: "Link didn't work" })).toBeInTheDocument();
    expect(server.callsTo('POST /auth/verify')).toHaveLength(0);
  });
});

describe('where to go after sign-in', () => {
  it.each(['/', '/t/1', '/t/1?x=y'])('allows the same-site path %s', (path) => {
    expect(isSafeNextPath(path)).toBe(true);
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', '', null])('rejects %j', (path) => {
    expect(isSafeNextPath(path)).toBe(false);
  });

  it('never redirects off-site, even if storage was tampered with', () => {
    localStorage.setItem('rc-next', '//evil.example');

    expect(takeNextPath()).toBe('/');
  });

  it('is used once', () => {
    rememberNextPath('/t/1');

    expect(takeNextPath()).toBe('/t/1');
    expect(takeNextPath()).toBe('/');
  });
});
