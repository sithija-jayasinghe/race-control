# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Race Control: live oversight for teams using AI coding agents. The full design is in `docs/SPEC.md`. Read it before starting any task, and follow its build plan (section 9) one week at a time.

## How to work

- Before writing code for a task, show the plan and the files you'll touch, and wait for approval.
- Work in small steps. Each step should build, pass tests and be committable on its own.
- Ask before adding a new dependency. Prefer the stack in `docs/SPEC.md` section 8.
- Write tests alongside code. The guardrail engine and team isolation must have thorough tests.
- If the spec is unclear or seems wrong, ask instead of guessing.
- Check https://code.claude.com/docs/en/hooks before implementing anything that depends on Claude Code hook formats.

## Conventions

- TypeScript strict mode everywhere. Shared types live in `packages/shared`.
- Monorepo layout: `apps/server` (Fastify), `apps/web` (React + Vite), `packages/shared`.
- The root `package.json` must set `"packageManager": "pnpm@<version>"` (CI uses it to install pnpm) and define `lint`, `typecheck` and `test` scripts.
- Validate all external input with zod.
- Every database query is scoped by `teamId`. Never return data across teams.
- Never log or store secrets. Redact `tool_input` before saving it.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Keep `CHANGELOG.md` updated under `## [Unreleased]` for user-visible changes.

## Commands

These exist once Week 1 is set up:

- `pnpm install` installs everything
- `pnpm dev` runs server and web together
- `pnpm lint`, `pnpm typecheck`, `pnpm test` must all pass before committing
