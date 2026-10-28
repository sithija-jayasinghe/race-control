# 0001: PGlite for database tests

- **Status:** accepted
- **Date:** 2026-10-28

## Context

The schema relies on Postgres features: enums, `jsonb`, an index on `lower(email)` and composite `(team_id, id)` foreign keys for team isolation. Tests need to prove those constraints really hold, so they must run against real Postgres, not a mock or SQLite.

Docker isn't available on every machine we develop on, and the CI workflow has no database service.

## Decision

Database tests use [PGlite](https://pglite.dev) (`@electric-sql/pglite`), a WebAssembly build of Postgres that runs inside the test process. Each test gets a fresh in-memory database with the committed Drizzle migrations applied (`apps/server/test/helpers/db.ts`).

Development and production use real Postgres via `DATABASE_URL` and the `postgres` driver.

## Consequences

- `pnpm test` needs no Docker, no local Postgres and no CI service, and the tests check the real migration SQL.
- PGlite is single-connection, so it can't test concurrency (for example, two hook requests racing). Add a real-Postgres test job if that becomes important.
- A fresh database per test costs roughly half a second. If the suite gets slow, share one database per file and reset tables between tests.
- HTTP tests use Fastify's built-in `inject` instead of Supertest, so the spec's stack table was updated.
