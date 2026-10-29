import { screen } from '@testing-library/react';
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

    expect(await screen.findByText(/no email is sent/)).toHaveTextContent('[dev mailer]');
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

  it('lets you go back and use a different email', async () => {
    fakeServer();
    renderApp('/sign-in');
    const user = await typeAndSend('dev@example.test');

    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));

    expect(screen.getByRole('heading', { name: 'Take your seat' })).toBeInTheDocument();
  });
});
