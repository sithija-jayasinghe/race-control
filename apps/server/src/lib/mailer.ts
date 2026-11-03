export interface Mailer {
  sendMagicLink(message: { to: string; url: string }): Promise<void>;
}

/** Sending failed. Carries no address or link, so it is safe to log. */
export class MailerError extends Error {
  override name = 'MailerError';
}

/**
 * Development only: prints magic links instead of emailing them.
 * The link is a login secret, so this must never be used in production.
 */
export function createConsoleMailer(print: (line: string) => void = console.log): Mailer {
  return {
    sendMagicLink({ to, url }) {
      print(`\n[dev mailer] Magic link for ${to}:\n${url}\n`);
      return Promise.resolve();
    },
  };
}

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/** The sign-in email: plain text first, and the same in simple HTML. The link is never put anywhere else. */
export function magicLinkEmail(url: string) {
  const text = [
    'Here is your link to sign in to Race Control:',
    '',
    url,
    '',
    'It works once and expires in 15 minutes. If you didn’t ask for it, you can ignore this email.',
  ].join('\n');
  const href = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<p>Here is your link to sign in to Race Control:</p>
<p><a href="${href}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111;color:#fff;text-decoration:none">Sign in to Race Control</a></p>
<p style="color:#666">It works once and expires in 15 minutes. If you didn’t ask for it, you can ignore this email.</p>`;
  return { subject: 'Your Race Control sign-in link', text, html };
}

/** Sends magic links through Resend's API. `fetch` is swappable for tests. */
export function createResendMailer(options: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const send = options.fetch ?? fetch;
  return {
    async sendMagicLink({ to, url }) {
      let response: Response;
      try {
        response = await send(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: options.from, to: [to], ...magicLinkEmail(url) }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (error) {
        throw new MailerError(`Resend request failed (${error instanceof Error ? error.name : 'unknown'})`);
      }
      // Resend's error bodies can echo the request, so only the status is kept.
      if (!response.ok) throw new MailerError(`Resend answered ${response.status}`);
    },
  };
}
