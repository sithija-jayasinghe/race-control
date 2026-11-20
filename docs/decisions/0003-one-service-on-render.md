# 0003: One service on Render's free plan

- **Status:** accepted
- **Date:** 2026-11-20

## Context

The real-world test (SPEC Week 5) needs a public URL: developers' hooks must reach the server, and leads approve from their phones. The trial team is mostly in Sri Lanka and elsewhere in Asia. It should cost nothing.

The spec planned the web app on Vercel and the server on Render or Fly.io. That split doesn't work for Race Control:

- **Live updates.** The dashboard keeps a WebSocket open at `/api/teams/:teamId/live`. Vercel's rewrites can't pass a WebSocket through to another server.
- **The login cookie.** The dashboard talks to the API on its own origin, so the `httpOnly` login cookie is first-party and the live channel can check that the request comes from `WEB_URL`. With the API on another site, the cookie becomes third-party, which browsers increasingly block, and the origin check would need loosening.
- **Free hosting.** Render's free plan gives 750 instance hours a month per workspace: enough for one service running all month, not two. Fly.io no longer has a free plan.

## Decision

**One Node service serves the whole site.** With `WEB_DIST` set, Fastify serves the built web app as well as the API (`apps/server/src/plugins/web.ts`):

- `/api/*` is the API, with the prefix stripped (Vite does the same in development).
- `/hooks/*` and `/health` stay where agents and uptime checks expect them.
- Every other browser path is the web app, falling back to `index.html`. The web app's paths overlap the API's (`/teams`, `/auth/verify`), so the browser's address space belongs to the web app.

**Render free, in Singapore, with Neon free Postgres in Singapore.** Singapore is the closest region either offers to Sri Lanka. Neon instead of Render's Postgres, because Render deletes free databases after 30 days. `render.yaml` describes the service; secrets are entered in Render's dashboard, never in the repo.

**Kept awake by a pinger.** A free Render service sleeps after 15 minutes without traffic, and waking takes about a minute, long enough to stall or (with "Block if down") refuse an agent's tool call. An external uptime check calls `/health` every 10 minutes. One service running all month uses about 744 of the 750 free hours.

**Migrations run on start.** The free plan has no pre-deploy step, so the start command runs `scripts/migrate.ts` (Drizzle's own migrator, already a dependency) before the server. Applied migrations are skipped, so restarts are safe.

**The client IP comes from Render's proxy.** `TRUST_PROXY=1` trusts the one proxy hop in front of the service, so rate limits count people, not the proxy. Fastify ignores a bare hop count, so the app passes a trust function; that's safe only because the service can't be reached except through Render's proxy.

## Consequences

- Free, HTTPS, and deploys on every push to `main`.
- The free instance has a tenth of a CPU and 512 MB. Hook overhead has to be measured on day 1 of the trial (target: under 50 ms when no rule matches). If it's too slow, the Starter plan ($7/month) removes the CPU limit and the need for a pinger; nothing else changes.
- Neon pauses after 5 minutes idle and wakes in a few hundred milliseconds, so the first request after a quiet spell is slower.
- A deploy or restart drops held approvals (they expire) and live connections (the dashboard reconnects). Deploy outside working hours during the trial.
- If the pinger stops, or another free service shares the workspace's hours, the service sleeps again.
- Running a second instance would split the in-memory live channels and held approvals between them. One instance is the design for the MVP.
- A custom domain later only needs `WEB_URL` and `PUBLIC_URL` set to it, plus new OAuth callback URLs.
