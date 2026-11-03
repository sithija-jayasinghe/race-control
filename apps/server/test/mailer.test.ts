import { describe, expect, it, vi } from 'vitest';
import { createResendMailer, MailerError } from '../src/lib/mailer.ts';

const LINK = 'https://rc.example/auth/verify#token=secret-login-token';

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
}

describe('createResendMailer', () => {
  it('sends the link to Resend from the configured sender', async () => {
    const fetch = fakeFetch(new Response('{"id":"e1"}', { status: 200 }));
    const mailer = createResendMailer({ apiKey: 're_test_key', from: 'Race Control <login@rc.example>', fetch });

    await mailer.sendMagicLink({ to: 'amaya@example.test', url: LINK });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer re_test_key' });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ from: 'Race Control <login@rc.example>', to: ['amaya@example.test'], subject: 'Your Race Control sign-in link' });
    expect(body.text).toContain(LINK);
    expect(body.html).toContain('href="https://rc.example/auth/verify#token=secret-login-token"');
  });

  it('fails without ever putting the link or address in the error', async () => {
    for (const response of [new Response(`{"message":"bad ${LINK}"}`, { status: 422 }), new TypeError('fetch failed')]) {
      const mailer = createResendMailer({ apiKey: 're_test_key', from: 'login@rc.example', fetch: fakeFetch(response) });

      const error = await mailer.sendMagicLink({ to: 'amaya@example.test', url: LINK }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MailerError);
      expect(String((error as Error).message)).not.toMatch(/secret-login-token|amaya/);
    }
  });
});
