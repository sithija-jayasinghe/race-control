# Race Control — live oversight for teams using AI coding agents

> In Formula 1, Race Control watches every car on track, enforces the rules and decides what's allowed. Here the cars are a team's AI coding agents, and the team lead sits in Race Control.

## 1. The problem

Teams now have several developers each running AI coding agents (Claude Code and others). Existing open-source dashboards show **one developer** their **own** agents on their **own** machine. Nobody gives a **team lead** a view across the whole team:

- What is every developer's agent doing right now, on which repo?
- Did an agent touch something it shouldn't (`.env`, migrations, `rm -rf`)?
- Who is spending what, and where did the time go this week?

## 2. Who it's for

| User | Wants |
|---|---|
| **Team lead** | A live view of the team's agents, rules that stop risky actions, approvals from their phone, a weekly summary |
| **Developer** | Zero setup friction, no slowdown, and confidence their code and prompts aren't being collected |

First real users: my own BuildFlow team (10 developers).

## 3. MVP scope

**In**
1. Team workspace with invite links and roles (`lead`, `developer`)
2. Per-developer tokens, and a copy-paste `.claude/settings.json` snippet generated for each developer
3. Event ingestion from Claude Code **HTTP hooks**
4. **Live dashboard**: active sessions per developer, a live event feed, and per-session timelines
5. **Guardrail rules**: match a tool call, then `allow`, `block` or `ask the lead`
6. **Approvals**: a risky action pauses the agent until the lead approves or denies it in the browser (mobile-friendly)
7. A **session simulator** that replays realistic fake sessions, so the demo always works

**Out (later phases)**
- Cost and token tracking (needs a small local reader for transcripts, see Phase 2)
- Weekly AI-written report
- Other agents (Codex, Cursor, and so on)
- Slack and email alerts, billing

## 4. How it works

```text
Developer's machine                               Race Control (cloud)
┌──────────────────────┐   HTTP hook POST    ┌───────────────────────────────┐
│ Claude Code          │ ──────────────────► │ Ingest API  /hooks/:event     │
│ .claude/settings.json│ ◄────────────────── │  ├─ auth (Bearer dev token)   │
│  (HTTP hooks)        │  allow/deny/ask JSON│  ├─ redact secrets            │
└──────────────────────┘                     │  ├─ guardrail engine          │
                                             │  ├─ store event (Postgres)    │
                                             │  └─ publish to team channel   │
                                             │            │                  │
Team lead's browser   ◄── WebSocket ─────────│  Realtime gateway             │
(dashboard, approvals) ── approve/deny ─────►│  Approvals service            │
                                             └───────────────────────────────┘
```

### Hook configuration a developer pastes

Hooks live in `.claude/settings.json` (project, shared via the repo), `.claude/settings.local.json` (project, git-ignored) or `~/.claude/settings.json` (all projects). Race Control generates this for each developer:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "http", "url": "https://racecontrol.example/hooks/SessionStart", "headers": { "Authorization": "Bearer $RACE_CONTROL_TOKEN" }, "allowedEnvVars": ["RACE_CONTROL_TOKEN"] }] }],
    "PreToolUse":   [{ "matcher": "*", "hooks": [{ "type": "http", "url": "https://racecontrol.example/hooks/PreToolUse", "timeout": 300, "headers": { "Authorization": "Bearer $RACE_CONTROL_TOKEN" }, "allowedEnvVars": ["RACE_CONTROL_TOKEN"] }] }],
    "PostToolUse":  [{ "matcher": "*", "hooks": [{ "type": "http", "url": "https://racecontrol.example/hooks/PostToolUse", "headers": { "Authorization": "Bearer $RACE_CONTROL_TOKEN" }, "allowedEnvVars": ["RACE_CONTROL_TOKEN"] }] }],
    "Stop":         [{ "hooks": [{ "type": "http", "url": "https://racecontrol.example/hooks/Stop", "headers": { "Authorization": "Bearer $RACE_CONTROL_TOKEN" }, "allowedEnvVars": ["RACE_CONTROL_TOKEN"] }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "http", "url": "https://racecontrol.example/hooks/SessionEnd", "headers": { "Authorization": "Bearer $RACE_CONTROL_TOKEN" }, "allowedEnvVars": ["RACE_CONTROL_TOKEN"] }] }]
  }
}
```

The developer then sets `export RACE_CONTROL_TOKEN=...` in their shell. Headers only interpolate variables listed in `allowedEnvVars`.

> **Verify against the current docs before building**: https://code.claude.com/docs/en/hooks. Hook event names, fields and output formats change between Claude Code versions.

### What a hook sends (the parts Race Control uses)

Every event: `session_id`, `cwd`, `hook_event_name`, `permission_mode`, `transcript_path`.
`PreToolUse` and `PostToolUse` also include `tool_name`, `tool_input` and `tool_use_id`.

### How Race Control answers `PreToolUse`

The response body uses Claude Code's hook output format:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by team rule: never edit .env files"
  }
}
```

- `allow`: run without asking the developer
- `deny`: block it, and the reason is shown to the agent
- `ask`: fall back to the developer's normal permission prompt
- An empty `200` response means no decision, and Claude Code's normal permission flow applies

## 5. Guardrail engine

A rule:

```ts
type Rule = {
  id: string;
  teamId: string;
  name: string;                 // "Never touch .env"
  tool: string;                 // "Bash" | "Edit" | "Write" | "*"
  pattern: string;              // glob/regex on the command or file path
  action: 'block' | 'approve';  // approve = pause and ask the team lead
  enabled: boolean;
};
```

Evaluation in the `PreToolUse` handler:
1. Load the team's enabled rules (cached in memory, invalidated on change)
2. Build the match target: `tool_input.command` for Bash, `tool_input.file_path` for Edit and Write
3. First matching rule wins:
   - `block`: respond `deny` with the rule name as the reason
   - `approve`: create an approval, push it to the lead's dashboard, and **hold the HTTP request open** until the lead decides or the wait expires
4. No match: respond with an empty `200` (no decision)

**Approval wait:** keep it below the hook `timeout` (300 s in the snippet). If nobody answers, respond `deny` with "No approval within 4 minutes". This is fail-closed for actions the team flagged as risky.

**If Race Control is down:** the hook can't reach the server. Expect the agent to carry on as normal (fail-open for availability), and confirm this behaviour in testing. Document this honestly. Race Control is a team safety net, not a security boundary.

Starter rules to seed every new team:
- Block: `Edit|Write` on `**/.env*`
- Block: `Bash` matching `rm -rf /` or `git push --force` to `main`
- Approve: `Edit|Write` on `**/migrations/**`
- Approve: `Bash` matching `npm publish`

## 6. Privacy and security

- **Redact before storing.** Strip anything that looks like a secret (API keys, tokens, passwords, private keys) from `tool_input`, the same idea as errbuddy's sanitizer.
- **Store metadata, not content.** Keep the command, file path, tool name and outcome. Don't store file contents or diffs in the MVP. Prompts (`UserPromptSubmit`) are not collected.
- **Tokens:** generate random tokens, store only a hash, show the token once, and allow revoking.
- **Team isolation:** every query is scoped by `teamId` from the authenticated token or session. Add tests that prove one team can't read another's data.
- **Rate limit** the ingest endpoints per token.

## 7. Data model

```text
teams(id, name, created_at)
users(id, email, name, created_at)
memberships(team_id, user_id, role: lead|developer)
dev_tokens(id, team_id, user_id, token_hash, label, last_used_at, revoked_at)
sessions(id, team_id, user_id, claude_session_id, repo_name, cwd, started_at, ended_at, status)
events(id, team_id, session_id, type, tool_name, summary, payload_redacted jsonb, decision, created_at)
rules(id, team_id, name, tool, pattern, action, enabled, created_by, created_at)
approvals(id, team_id, session_id, event_id, rule_id, status: pending|approved|denied|expired,
          requested_at, decided_at, decided_by)
```

Index `events(team_id, created_at desc)` and `events(session_id, created_at)`.

## 8. Tech stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across server, web and shared types |
| Repo | pnpm workspaces: `apps/server`, `apps/web`, `packages/shared` | Shared event and rule types |
| Server | Fastify + `@fastify/websocket` | Fast, typed, easy long-held requests for approvals |
| Database | PostgreSQL (Neon free tier) + Drizzle ORM | Relational data with JSONB for event payloads |
| Web | React + Vite + Tailwind CSS + TanStack Query | Fast dashboard, live updates via WebSocket |
| Auth | Email magic link (or GitHub OAuth) for users; Bearer tokens for hooks | Simple and secure |
| Tests | Vitest + Supertest; Playwright for one end-to-end flow | Confidence in the guardrail engine and team isolation |
| Deploy | Server on Render or Fly.io, web on Vercel, Neon Postgres | Free or very cheap to run a demo |
| CI | GitHub Actions: lint, type-check, test on every push | Same habits as errbuddy |

## 9. Build plan

**Week 1 — Foundations**
- Monorepo, TypeScript config, lint, CI
- Database schema and migrations (Drizzle)
- Auth, teams, invites, roles
- Developer tokens: create, hash, show once, revoke

**Week 2 — Ingestion**
- `POST /hooks/:event` with Bearer auth, validation (zod) and secret redaction
- Session tracking: create on `SessionStart`, update on events, close on `SessionEnd` or `Stop`
- Settings snippet generator page for developers
- **Session simulator** script: replays realistic sessions (edits, test runs, a blocked action) against the API

**Week 3 — Live dashboard**
- WebSocket channel per team
- Team view: who's active, on which repo, last action
- Live event feed and per-session timeline

**Week 4 — Guardrails and approvals**
- Rules CRUD UI with the starter rules
- Rule engine in `PreToolUse` with unit tests for every rule type
- Approvals: hold the request, show it live to the lead, approve or deny, expire safely
- Mobile-friendly approval screen

**Week 5 — Real-world test**
- Run it with the BuildFlow team for a week
- Fix what breaks, measure added latency per hook (target: under 50 ms when no rule matches)

**Week 6 — Launch**
- Deploy, a demo team with simulator data, README with a GIF, architecture diagram and the honest limitations
- Write-up: "What I learned watching 10 developers' AI agents for a week"

## 10. Phase 2 ideas

- **Cost tracking:** a tiny local helper (`npx race-control-agent`) that reads `transcript_path` on `Stop` and reports token usage per session
- **Weekly AI report** per developer and per repo
- Slack alerts for blocked actions and pending approvals
- Policies distributed through Claude Code's managed settings for whole organisations
- Support for more agents

## 11. Definition of done for the MVP

- A developer goes from invite to live events in under 5 minutes
- A rule blocks `.env` edits in a real Claude Code session
- A lead approves a migration edit from their phone, and the agent continues
- One team can never see another team's data (tests prove it)
- Hook overhead is under 50 ms when no rule matches
- The public demo works without any real agent, thanks to the simulator
