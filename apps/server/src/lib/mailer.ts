export interface Mailer {
  sendMagicLink(message: { to: string; url: string }): Promise<void>;
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
