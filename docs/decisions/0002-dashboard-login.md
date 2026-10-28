# 0002: Dashboard login

- **Status:** accepted
- **Date:** 2026-10-28

## Context

People sign in to the dashboard to watch sessions, approve actions from their phone and manage their team. Agents never sign in: hooks authenticate with developer tokens (SPEC section 6).

We want four sign-in methods (magic link, GitHub, Google, passkeys) without passwords, and no Claude or ChatGPT credentials ever.

## Decision

**One user, many identities.** `users` is the person. `auth_identities` links sign-in methods to them, unique on `(provider, provider_user_id)`. Passkeys get their own table when they're built.

**Joining a method to an account.** A new method joins an existing user only when it proves the same email: the magic link proves it by being opened; GitHub and Google only when they report the email as **verified**. Otherwise anyone could register a GitHub account with someone else's email and take over their account. Passkeys are added by a signed-in user, never used to create an account.

**Magic link flow.**
1. `POST /auth/magic-link {email}` always answers `202`, so it doesn't reveal who has an account. At most 3 links per email per 15 minutes, and 5 requests per IP per 15 minutes.
2. The link is `WEB_URL/auth/verify#token=...`. The token sits in the URL fragment, which browsers never send to servers or in `Referer` headers.
3. The web page sends the token with `POST /auth/verify`. Using POST means email scanners that open links can't use it up.
4. The token is single-use and expires after 15 minutes. It is consumed with one conditional `UPDATE`, so two requests can't both use it.

**Login cookie.** `rc_session`, a random 256-bit value. Only its SHA-256 is stored, in `auth_sessions`. `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, 30-day fixed expiry so a lead stays signed in on their phone. `last_seen_at` is updated at most hourly.

**Hashing.** Tokens are random, not passwords, so a plain SHA-256 is enough; no salt or slow hash.

**Errors.** Responses never include internal details, and logs keep only error names, codes and stack frames. Database errors carry the SQL, its parameters and row values, which would otherwise leak emails and token hashes.

## Consequences

- No passwords to store, reset or leak.
- Production needs an email service before deploy (for example Resend). Until then the server refuses to start with `NODE_ENV=production`, and development prints links to the console. That console line is a login secret, which is acceptable only on a developer's own machine.
- **Cookies and deployment:** a `SameSite=Lax` cookie isn't sent on requests between unrelated sites, so the web app and the API must look like one site. Either serve the API under the web app's domain (for example a Vercel rewrite from `/api` to the server) or put both on subdomains of one domain. Decide in Week 6.
- `SESSION_SECRET` was removed from `.env.example`: sessions are looked up by hash, so nothing needs signing.
