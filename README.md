<div align="center">

# 🏁 Race Control

**Live oversight for teams using AI coding agents.**

See what every developer's agent is doing, stop risky actions with team rules, and approve sensitive changes from your phone.

[![CI](https://github.com/sithija-jayasinghe/race-control/actions/workflows/ci.yml/badge.svg)](https://github.com/sithija-jayasinghe/race-control/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-in%20development-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> 🚧 **Race Control is in active development.** Follow the [roadmap](#roadmap) below, or read the full [design spec](docs/SPEC.md).

## Why

Teams now run AI coding agents across many developers and repos. Existing dashboards show **one developer** their **own** agents. Nobody gives a **team lead** the full picture:

- What is each developer's agent doing right now, and on which repo?
- Did an agent touch something it shouldn't, like `.env` files, database migrations or `git push --force`?
- Who should approve a risky change before it happens?

In Formula 1, Race Control watches every car, enforces the rules and decides what's allowed. Race Control does the same for your team's AI agents.

## Features (MVP)

| | Feature | What it does |
|---|---|---|
| 📡 | **Live team view** | Every active agent session across the team, with a real-time event feed and per-session timelines |
| 🚩 | **Guardrail rules** | Team rules such as "never edit `.env`" or "no force-push to `main`" that block the agent instantly |
| ✋ | **Approvals** | Risky actions pause the agent until a team lead approves or denies them, from desktop or phone |
| ⚡ | **Zero install** | Developers paste a settings snippet. Claude Code's HTTP hooks send events directly, so there's nothing to install |
| 🔒 | **Privacy first** | Secrets are redacted before storage. Commands and file paths are kept, but file contents and prompts are not |
| 🎬 | **Simulator** | Replays realistic agent sessions, so the demo works without running real agents |

## How it works

```text
Developer's machine                          Race Control
┌──────────────────────┐  HTTP hook   ┌──────────────────────────────┐
│ Claude Code          │ ───────────► │ Ingest API                   │
│ (.claude/settings)   │ ◄─────────── │  auth · redact · rules · log │
└──────────────────────┘ allow / deny └──────────────┬───────────────┘
                                                     │ WebSocket
                                      ┌──────────────▼───────────────┐
                                      │ Team lead's dashboard        │
                                      │ live feed · approvals        │
                                      └──────────────────────────────┘
```

1. A developer adds Race Control's hooks to `.claude/settings.json` and sets their personal token.
2. Each agent action (session start, tool call, finish) is sent to Race Control.
3. Before a tool runs, Race Control checks the team's rules and answers **allow**, **deny**, or holds the action for **approval**.
4. Team leads watch everything live and decide on approvals.

See [docs/SPEC.md](docs/SPEC.md) for the full design: data model, guardrail engine, security model and build plan.

## Tech stack

**TypeScript** monorepo (pnpm workspaces) · **Fastify** + WebSockets · **PostgreSQL** + Drizzle ORM · **React** + Vite + Tailwind CSS · **Vitest** and Playwright · **GitHub Actions**

## Roadmap

- [ ] **Week 1 — Foundations:** monorepo, database schema, auth, teams and developer tokens
- [ ] **Week 2 — Ingestion:** hook endpoints, secret redaction, session tracking and the simulator
- [ ] **Week 3 — Live dashboard:** WebSocket feed, team view and session timelines
- [ ] **Week 4 — Guardrails and approvals:** rules engine, approval flow and mobile approval screen
- [ ] **Week 5 — Real-world test:** a week of use with a real 10-developer team
- [ ] **Week 6 — Launch:** deployment, public demo and write-up

## Getting started

Setup instructions will be added once the first runnable version is in place (Week 2).

```bash
git clone https://github.com/sithija-jayasinghe/race-control.git
cd race-control
cp .env.example .env
```

## Contributing

Ideas and feedback are welcome. Open an [issue](https://github.com/sithija-jayasinghe/race-control/issues) or read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Sithija Harshana Jayasinghe
