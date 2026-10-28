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
8. **Team Radio heads-ups**: when an agent touches a file another agent on the team touched recently, Race Control tells it so (see section 12)
9. **Shadow mode** for rules: a new rule logs "would have blocked" before it is enforced

**Out (later phases)**
- Cost and token tracking (needs a small local reader for transcripts, see Phase 2)
- Weekly AI-written report
- Other agents (Codex, Cursor, and so on). The data model already records which agent a session belongs to
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

HTTP hooks time out after 600 s by default. The snippet sets 300 s on `PreToolUse` so a held approval expires on Race Control's side first. A hook can also set `"onFailure": "block"` (Claude Code v2.1.295+) so the tool call is blocked if Race Control can't be reached (see section 5).

> **Verify against the current docs before building**: https://code.claude.com/docs/en/hooks. Hook event names, fields and output formats change between Claude Code versions. Last checked: 2026-10-27.

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
- `defer`: also listed in the current docs. Race Control doesn't use it, and its exact meaning should be confirmed before Week 4
- An empty `200` response means no decision, and Claude Code's normal permission flow applies

The same `hookSpecificOutput` can carry `additionalContext`, a string added to Claude's context. Team Radio uses it (section 12). It is ignored when `permissionDecision` is `defer`.

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
  mode: 'enforce' | 'shadow';   // shadow = record "would have matched", never block
  enabled: boolean;
};
```

Evaluation in the `PreToolUse` handler:
1. Load the team's enabled rules (cached in memory, invalidated on change)
2. Build the match target: `tool_input.command` for Bash, `tool_input.file_path` for Edit and Write
3. Record every matching `shadow` rule on the event, without acting on it
4. First matching `enforce` rule wins:
   - `block`: respond `deny` with the rule name as the reason
   - `approve`: create an approval, push it to the lead's dashboard, and **hold the HTTP request open** until the lead decides or the wait expires
5. No match: respond with an empty `200` (no decision), or with only a Team Radio `additionalContext`

New rules start in `shadow` mode, so the lead can see what a rule would catch before it blocks anyone. When a lead approves an action, they can choose "always allow this", which creates a matching rule.

**Approval wait:** keep it below the hook `timeout` (300 s in the snippet). If nobody answers, respond `deny` with "No approval within 4 minutes". This is fail-closed for actions the team flagged as risky.

**If Race Control is down:** by default, a hook that can't reach the server is a non-blocking error and the agent carries on (fail-open for availability). A team can choose fail-closed instead: the snippet generator adds `"onFailure": "block"` to the `PreToolUse` hook. Default to fail-open, and confirm both behaviours in testing. Document this honestly. Race Control is a team safety net, not a security boundary.

Starter rules to seed every new team:
- Block: `Edit|Write` on `**/.env*`
- Block: `Bash` matching `rm -rf /` or `git push --force` to `main`
- Approve: `Edit|Write` on `**/migrations/**`
- Approve: `Bash` matching `npm publish`

## 6. Privacy and security

- **Redact before storing.** Strip anything that looks like a secret (API keys, tokens, passwords, private keys) from `tool_input`, the same idea as errbuddy's sanitizer.
- **Store metadata, not content.** Keep the command, file path, tool name and outcome. Don't store file contents or diffs in the MVP. Prompts (`UserPromptSubmit`) are not collected.
- **Tokens:** generate random tokens, store only a hash, show the token once, and allow revoking.
- **Team isolation:** every query is scoped by `teamId` from the authenticated token or session. Add tests that prove one team can't read another's data. In the API, a `:teamId` in the URL is only used after the user's membership is confirmed; teams you aren't in answer `404`, exactly like teams that don't exist.
- **Invites** are reusable links that expire after 7 days and can be revoked by a lead. Like magic links, the token sits in the URL fragment and only its hash is stored. A team always keeps at least one lead.
- **Rate limit** the ingest endpoints per token.
- **Agent-to-agent text is untrusted.** Anything Race Control puts into an agent's context (Team Radio) could be used for prompt injection. Heads-ups are built by the server from stored metadata (who, which file, when, which agent), never from free text another agent wrote. Free-text notes (Phase 2) are length-limited, redacted, clearly labelled as information rather than instructions, and a lead can turn them off.

## 7. Data model

```text
teams(id, name, created_at)
users(id, email, name, created_at)
memberships(team_id, user_id, role: lead|developer)
dev_tokens(id, team_id, user_id, token_hash, label, last_used_at, revoked_at)
sessions(id, team_id, user_id, agent: claude_code|codex, agent_session_id, repo_name, cwd,
         started_at, ended_at, status: active|idle|ended)
events(id, team_id, session_id, type, tool_name, target, summary, payload_redacted jsonb,
       decision: allow|deny|ask|none|pending, created_at)
rules(id, team_id, name, tool, pattern, action: block|approve, mode: enforce|shadow, enabled,
      created_by, created_at)
approvals(id, team_id, session_id, event_id, rule_id, status: pending|approved|denied|expired,
          requested_at, decided_at, decided_by)

invites(id, team_id, token_hash, role, created_by, expires_at, revoked_at, created_at)

-- Dashboard login (ADR 0002). Owned by people, not teams.
auth_identities(id, user_id, provider: email|github|google, provider_user_id, email, created_at)
login_tokens(id, email, token_hash, expires_at, used_at, created_at)        -- magic links
auth_sessions(id, user_id, token_hash, expires_at, last_seen_at, created_at) -- login cookies
```

- `sessions.agent_session_id` is the agent's own session id (Claude Code's `session_id`). It is unique per team and agent.
- `events.type` is the hook event name. `events.target` is the normalised thing a tool acted on: a repo-relative file path for Edit and Write, the command for Bash. Guardrails, collisions and Team Radio all match on it.
- Rows that belong to a team reference other team-owned rows through `(team_id, id)` foreign keys, so the database itself rejects, for example, an event that points at another team's session. A dev token references `memberships(team_id, user_id)`, so it can only exist for a member of its team.
- Deleting a team deletes all of its data. Removing a member deletes their dev tokens. Deleting a rule deletes its approvals (events keep their decision), so the rules UI should disable rules rather than delete them.
- `users.email` is unique regardless of case.

Index `events(team_id, created_at desc)`, `events(session_id, created_at)` and `events(team_id, target, created_at desc)` (for overlap lookups).

## 8. Tech stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across server, web and shared types |
| Repo | pnpm workspaces: `apps/server`, `apps/web`, `packages/shared` | Shared event and rule types |
| Server | Fastify + `@fastify/websocket` | Fast, typed, easy long-held requests for approvals |
| Database | PostgreSQL (Neon free tier) + Drizzle ORM | Relational data with JSONB for event payloads |
| Web | React + Vite + Tailwind CSS + TanStack Query | Fast dashboard, live updates via WebSocket |
| Auth | Users: magic link, then GitHub, Google and passkeys, all linked to one account ([ADR 0002](decisions/0002-dashboard-login.md)); a 30-day `httpOnly` cookie. Hooks: Bearer developer tokens | No passwords to store; developers sign in the way they already do |
| Tests | Vitest, Fastify `inject` for HTTP, PGlite for database tests ([ADR 0001](decisions/0001-pglite-for-database-tests.md)); Playwright for one end-to-end flow | Confidence in the guardrail engine and team isolation |
| Deploy | Server on Render or Fly.io, web on Vercel, Neon Postgres | Free or very cheap to run a demo |
| CI | GitHub Actions: lint, type-check, test on every push | Same habits as errbuddy |

## 9. Build plan

**Week 1 — Foundations**
- Monorepo, TypeScript config, lint, CI
- Database schema and migrations (Drizzle), including `sessions.agent`, `events.target` and `rules.mode`
- Auth (magic link first), teams, invites, roles
- Developer tokens: create, hash, show once, revoke
- Web pages: sign in, create a team, members and invites, tokens
- Sign in with GitHub and Google, then passkeys (may carry over into Week 2)

**Week 2 — Ingestion**
- `POST /hooks/:event` with Bearer auth, validation (zod) and secret redaction
- Session tracking: create on `SessionStart`, update on events, close on `SessionEnd` or `Stop`
- Settings snippet generator page for developers
- **Session simulator** script: replays realistic sessions (edits, test runs, a blocked action) against the API

**Week 3 — Live dashboard**
- WebSocket channel per team
- Team view: who's active, on which repo, last action
- Live event feed and per-session timeline
- **Yellow flag:** highlight when two sessions touch the same `target` within a time window
- **Team Radio heads-ups:** reply to `PreToolUse` with `additionalContext` when another agent touched the same file recently

**Week 4 — Guardrails and approvals**
- Rules CRUD UI with the starter rules
- Rule engine in `PreToolUse` with unit tests for every rule type, including shadow mode
- Approvals: hold the request, show it live to the lead, approve or deny, expire safely
- "Always allow this" on an approval creates a rule
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
- **Team Radio over MCP**, so agents can ask and leave notes, and so Codex can join (section 12)
- **Remote approvals for developers:** answer your own agent's permission prompts from your phone, using the `PermissionRequest` hook
- **Safety car:** alert when an agent loops on the same failing command, or has waited on a permission prompt too long
- **Rules as code:** a `.racecontrol.yml` in the repo, so rule changes go through pull request review
- **Transparency page:** each developer sees exactly what their lead sees about them
- Support for more agents

## 11. Definition of done for the MVP

- A developer goes from invite to live events in under 5 minutes
- A rule blocks `.env` edits in a real Claude Code session
- A lead approves a migration edit from their phone, and the agent continues
- One team can never see another team's data (tests prove it)
- Hook overhead is under 50 ms when no rule matches
- The public demo works without any real agent, thanks to the simulator
- When two simulated developers edit the same file, the second agent receives a Team Radio heads-up

## 12. What makes Race Control different

Other tools already offer a live view, hook guardrails and approvals (see [docs/research/competitive-landscape.md](research/competitive-landscape.md)). They show agent activity to **humans**. Race Control also shares it **between agents**, and gives developers something back.

### Team Radio

In F1, the team radio keeps every driver aware of what's happening on track. Race Control already sees every agent's actions across the team, so it can tell each agent what the others are doing.

**Part 1: heads-ups (MVP, Claude Code).** When an agent is about to touch a `target` that another session on the same team and repo touched recently, Race Control answers `PreToolUse` with `additionalContext`:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Race Control: Nimal's codex agent edited src/auth/session.ts 2 minutes ago. Check for conflicting changes before editing it."
  }
}
```

- The message is built only from stored metadata (developer name, agent, target, time). It never includes another agent's free text, file contents or prompts.
- To keep noise and token cost down, only send it on overlap, at most once per target per session, within a configurable window (default 30 minutes).
- The same overlap check drives the lead's **yellow flag** on the dashboard.
- The developer pastes nothing extra: it reuses the `PreToolUse` hook.

**Part 2: talking over MCP (Phase 2).** Race Control exposes a remote MCP server, authenticated with the same developer token. Both Claude Code and Codex CLI support remote MCP servers over HTTP. Tools:

- `who_is_working_on(path)`: recent sessions that touched a path
- `post_note(text, paths?)` and `read_notes(repo)`: short notes such as "refactoring src/auth, avoid until done"
- `claim(path)` and `release(path)`: soft locks other agents can see. Advisory only, not enforced

This is how agents from different vendors (Claude Code and Codex) coordinate. Notes follow the untrusted-text rules in section 6.

**Open questions:** does Codex have a pre-tool hook that could support Part 1? (Unconfirmed as of 2026-10-27.) How should "the same repo" be detected, by repo name, git remote or `cwd`?

### Other differentiators

| Feature | Phase | Why it matters |
|---|---|---|
| Yellow flag (collision alerts for the lead) | MVP, Week 3 | Only makes sense for a team, and no tool we found offers it |
| Shadow mode, and "always allow" turning approvals into rules | MVP, Week 4 | Rules can be tuned without breaking anyone's flow |
| Remote approvals for developers (`PermissionRequest`) | Phase 2 | Gives developers a reason to install it, not just leads |
| Safety car, rules as code, transparency page | Phase 2 | Trust and adoption |
