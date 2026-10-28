# Changelog

All notable changes to Race Control are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Project design spec, repository setup and CI.
- Competitive landscape research (`docs/research/competitive-landscape.md`).
- Spec: Team Radio (agents get heads-ups about other agents' work), yellow flag collision alerts and shadow mode for rules.
- pnpm monorepo with strict TypeScript, ESLint, Vitest and root `lint`, `typecheck` and `test` scripts.
- `@race-control/shared` package with the shared value lists (roles, agents, statuses, decisions) and their zod schemas.
- Server skeleton (Fastify) with `GET /health` and validated environment config.
- Web app skeleton (React + Vite), with `/api` proxied to the server in development.
- `pnpm dev` runs the server and web app together.
- Database schema (Drizzle + Postgres) for teams, users, memberships, dev tokens, sessions, events, rules and approvals, with the first migration. Team-scoped foreign keys stop rows from referencing another team's data.
- Database tests on an in-memory Postgres (PGlite), including team isolation tests.
- README setup instructions.
- Sign in with a magic link: single-use links that expire after 15 minutes, a 30-day login cookie, sign out, and `GET /me`. Login requests are rate-limited.
- Server errors return a generic message and are logged without query text, parameters or other personal data.
- Teams: create a team (you become its lead), list members, change roles, remove members or leave. A team always keeps at least one lead.
- Invite links: leads create reusable links for a role, valid for 7 days and revocable. Anyone with the link sees the team name, and joins after signing in.
- Teams you aren't a member of are invisible: every team route answers 404, the same as for a team that doesn't exist.

### Removed
- `SESSION_SECRET` from `.env.example`. Login sessions are looked up by hash, so nothing needs signing.

### Changed
- Spec: hook details updated against the current Claude Code docs (600 s default timeout, `onFailure`, `defer`, `additionalContext`).
- Spec: data model now records which agent a session belongs to (`sessions.agent`, `agent_session_id`), adds `events.target` and `rules.mode`, and uses team-scoped foreign keys.
