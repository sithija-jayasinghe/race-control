/** Stand-ins for GitHub's and Google's OAuth endpoints, for tests. */
export type FakeAccounts = {
  github?: {
    id?: number;
    login?: string;
    name?: string | null;
    emails?: Array<{ email: string; primary: boolean; verified: boolean }>;
    tokenStatus?: number;
  };
  google?: { sub?: string; email?: string; email_verified?: boolean; name?: string; tokenStatus?: number };
};

export function fakeProviders(accounts: FakeAccounts) {
  const tokenRequests: Array<Record<string, string>> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === 'https://github.com/login/oauth/access_token' || url === 'https://oauth2.googleapis.com/token') {
      tokenRequests.push(Object.fromEntries(new URLSearchParams(typeof init?.body === 'string' ? init.body : '')));
      const status = (url.includes('github') ? accounts.github : accounts.google)?.tokenStatus ?? 200;
      return Promise.resolve(status === 200 ? json({ access_token: 'access-token', token_type: 'bearer' }) : json({ error: 'bad_verification_code' }, status));
    }
    const gh = accounts.github ?? {};
    if (url === 'https://api.github.com/user') return Promise.resolve(json({ id: gh.id ?? 1, login: gh.login ?? 'someone', name: gh.name ?? null }));
    if (url === 'https://api.github.com/user/emails') return Promise.resolve(json(gh.emails ?? []));
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      const g = accounts.google ?? {};
      return Promise.resolve(json({ sub: g.sub ?? 'g1', email: g.email, email_verified: g.email_verified, name: g.name }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
  return { fetch, tokenRequests };
}
