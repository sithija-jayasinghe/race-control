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
- Developer tokens: create a `rc_…` token for your agent hooks (shown once, stored as a hash), list and revoke them. Leads can see and revoke every token in their team.
- UI design (`docs/design/UI.md`): an F1 broadcast of your agents, dark first, with floating glass panels over a 3D track scene. Includes the interactive Pit wall prototype the direction came from.
- Web app design system in that style: the Race / Control wordmark, a lights-out start (once per session, skipped with reduced motion), an F1 TV-style timing tower, Race Control flag banners, Team Radio cards, a LIVE session clock, and status flags that always pair colour with a word. Icon rail on desktop, floating tab bar on phones. Dark by default, with light and system themes.
- Sign-in pages: enter your email, check your inbox, open the link and you're in. The link's token is removed from the address bar straight away, and after signing in you return to the page you were trying to open. Account menu with theme choice and sign out.
- Signed-out visitors are sent to sign in; signed-in visitors land on their first team's Pit wall, or a first-run page if they're not on a team yet.
- Create a team from the first-run page or the team switcher in the top bar.
- Invite page: open an invite link to see the team and your role, sign in if needed (you come straight back), and join.
- Team page: members and roles; leads can change roles, remove members (with a confirm step) and create, copy and revoke invite links. Anyone can leave a team, and the last lead is told why they can't step down.
- Settings page: create agent tokens (shown once, with copy buttons for the token and the `export RACE_CONTROL_TOKEN=…` line), see when each was last used, and revoke them. Leads see everyone's tokens. Theme choice.
- The Pit wall now starts as an empty track ("No cars on track") with the steps to connect an agent, and a "Watch a demo race" mode with sample drivers.
- Hook endpoint `POST /hooks/:event` for Claude Code's HTTP hooks: authenticated with your agent token, rate-limited per token, and always answers quickly with "no decision" so agents carry on. Records sessions (active, idle, ended) and every tool call.
- Secret redaction before anything is stored: only the command, file path or URL of each tool call is kept (never file contents, prompts, replies or tool output), and API keys, tokens, passwords and private keys are replaced with `[REDACTED]`.
- Connect Claude Code: Settings shows the `.claude/settings.json` hooks for your server, for one project or all of yours, with a copy button. The token is read from `RACE_CONTROL_TOKEN`, so the file can be committed for the whole team.
- The Pit wall lists the team's sessions as they report in (status, who, repo, last action), counts the cars on track, and hides the setup steps once your own agent is connected.

### Removed
- `SESSION_SECRET` from `.env.example`. Login sessions are looked up by hash, so nothing needs signing.

### Changed
- Spec: hook details updated against the current Claude Code docs (600 s default timeout, `onFailure`, `defer`, `additionalContext`).
- Spec: data model now records which agent a session belongs to (`sessions.agent`, `agent_session_id`), adds `events.target` and `rules.mode`, and uses team-scoped foreign keys.
