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

### Changed
- Spec: hook details updated against the current Claude Code docs (600 s default timeout, `onFailure`, `defer`, `additionalContext`).
- Spec: data model now records which agent a session belongs to (`sessions.agent`, `agent_session_id`), adds `events.target` and `rules.mode`, and uses team-scoped foreign keys.
