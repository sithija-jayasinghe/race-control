import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, renderApp } from './helpers.tsx';

async function typeAndSend(email: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Email' }), email);
  await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
  return user;
}

describe('sign-in page', () => {
  it('sends a link and tells you to check your email', async () => {
    const server = fakeServer();
    renderApp('/sign-in');

    await typeAndSend('  Dev@Example.TEST ');

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('dev@example.test')).toBeInTheDocument();
    expect(server.callsTo('POST /auth/magic-link')).toEqual([
      { method: 'POST', path: '/auth/magic-link', body: { email: 'dev@example.test' } },
    ]);
    expect(screen.getByRole('button', { name: /Send again in \d+s/ })).toBeDisabled();
  });

  it('says where the link really is in development, where no email is sent', async () => {
    fakeServer();
    renderApp('/sign-in');

    await typeAndSend('dev@example.test');

    expect(await screen.findByText(/unless an email service is set up/)).toHaveTextContent('[dev mailer]');
  });

  it('checks the email before sending anything', async () => {
    const server = fakeServer();
    renderApp('/sign-in');

    await typeAndSend('not-an-email');

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
    expect(server.callsTo('POST /auth/magic-link')).toHaveLength(0);
  });

  it('explains rate limits', async () => {
    const server = fakeServer();
    server.on('POST /auth/magic-link', () => ({ status: 429, body: { error: 'rate_limited' } }));
    renderApp('/sign-in');

    await typeAndSend('dev@example.test');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('explains when the server is unreachable', async () => {
    const server = fakeServer();
    server.on('POST /auth/magic-link', () => 'network-error');
    renderApp('/sign-in');

    await typeAndSend('dev@example.test');

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Race Control");
  });

  it('says when the email could not be sent', async () => {
    const server = fakeServer();
    server.on('POST /auth/magic-link', () => ({ status: 502, body: { error: 'email_failed' } }));
    renderApp('/sign-in');

    await typeAndSend('dev@example.test');

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send the email. Try again in a minute.');
  });

  it('lets you go back and use a different email', async () => {
    fakeServer();
    renderApp('/sign-in');
    const user = await typeAndSend('dev@example.test');

    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));

    expect(screen.getByRole('heading', { name: 'Take your seat' })).toBeInTheDocument();
  });

  it('offers GitHub and Google when the server has them, going back where you were headed', async () => {
    const server = fakeServer();
    server.on('GET /auth/providers', () => ({ status: 200, body: { providers: ['github', 'google'] } }));
    localStorage.setItem('rc-next', '/t/abc/approvals');
    renderApp('/sign-in');

    const github = await screen.findByRole('link', { name: 'Sign in with GitHub' });
    expect(github).toHaveAttribute('href', '/api/auth/github/start?next=%2Ft%2Fabc%2Fapprovals');
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', expect.stringMatching(/^\/api\/auth\/google\/start/));
    localStorage.clear();
  });

  it('shows only the email link when no provider is set up', async () => {
    fakeServer();
    renderApp('/sign-in');

    await screen.findByRole('button', { name: 'Send sign-in link' });
    await waitFor(() => expect(screen.queryByRole('link', { name: /Sign in with/ })).not.toBeInTheDocument());
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it.each([
    ['no_verified_email', 'GitHub didn’t share a verified email. Verify one there, or use the email link.'],
    ['cancelled', 'Signing in with GitHub was cancelled.'],
    ['expired', 'That sign-in took too long or was interrupted. Try again.'],
    ['failed', 'GitHub didn’t answer properly. Try again, or use the email link.'],
  ])('explains why GitHub sign-in came back with %s', async (error, message) => {
    fakeServer();
    renderApp(`/sign-in?error=${error}&provider=github`);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});
