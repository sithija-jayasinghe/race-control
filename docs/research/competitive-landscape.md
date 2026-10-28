# Competitive landscape

Researched on 2026-10-27. Feature claims come from product pages, READMEs and blog posts, not hands-on testing. Re-check before quoting them publicly.

## Summary

The core MVP idea (a live team view, guardrail rules on hooks, approvals) is **not unique**. Several tools do parts of it, and one hosted product (AgentTrail) covers most of it. Race Control has to stand out through features that only make sense for a **team** of agents working side by side. See [SPEC section 12](../SPEC.md#12-what-makes-race-control-different).

## Products

| Product | Type | What it does | Overlap with Race Control |
|---|---|---|---|
| [AgentTrail](https://www.agenttrail.sh/) | Hosted (OS) plus open-source local guard (Apache 2.0) | Team view of sessions, tool calls, tokens and cost. Guardrails that can be backtested against 30 days of sessions. Approvals and an audit trail. Claude Code and Cursor (the local guard also supports Codex). Per-seat pricing, free tier | **Closest competitor.** Covers the MVP except a clearly described in-band approval hold |
| [claude-security-guardrails](https://github.com/mafiaguy/claude-security-guardrails) | Open source | PreToolUse/PostToolUse hooks that block 30+ risky patterns, plus a React dashboard that can run as a shared service for an org | Guardrails and a central log of blocks. No approvals |
| [MintMCP / Mintive Agent Monitor](https://www.mintmcp.com/blog/claude-code-monitoring) | Commercial | Live activity feed, filter by user, flag / block / ask-user actions | Team feed and guardrails |
| [Unbound](https://www.getmaxim.ai/articles/top-5-ai-governance-tools-for-coding-agents-in-2026/) | Commercial | Allow, deny, warn and approve policies on agent terminal and MCP activity | Enterprise governance |
| [Bifrost](https://www.getmaxim.ai/articles/top-5-ai-governance-tools-for-coding-agents-in-2026/) | Open-source gateway | Routes Claude Code, Cursor, Codex and Copilot through one policy layer, with a spend ledger and audit trail | Governance at the model API layer, not at tool calls |
| [disler multi-agent observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | Open source | Hook events through Bun and SQLite to a live Vue dashboard | Viewing only, one developer |
| [agents-observe](https://blog.brightcoding.dev/2026/08/07/simple10agents-observe-real-time-dashboard-for-claude-code-sessions) | Open source (MIT) | Claude Code plugin with a React dashboard, agent hierarchy and session replay | Viewing only, one developer |
| [Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) | Open source | Self-hosted multi-user dashboard for Claude Code and Codex, Kanban status board | Live team view, no guardrails |
| [Marc Nuri's agent dashboard](https://blog.marcnuri.com/ai-coding-agent-dashboard) | Blog post / personal tool | Shows agent state (working, idle, waiting for permission) across devices | Status only |
| Anthropic built-ins ([overview](https://langwatch.ai/blog/claude-code-enterprise-usage-spend-governance)) | First party | Analytics dashboard (active users, sessions, accepted lines), OpenTelemetry export, managed settings | Usage metrics and org-wide policy. **Don't compete on usage metrics** |

## Gaps none of them clearly fill

1. **Agent-to-agent awareness.** Every tool shows agent activity to *humans*. None says it tells an agent what the other agents on the team are doing.
2. **Collision detection.** No tool mentions warning when two developers' agents edit the same file at the same time.
3. **Something in it for the developer.** Most tools are built for the lead or for security. Developers get oversight and nothing back, which hurts adoption.

## Facts from the Claude Code hooks docs that matter

Checked against https://code.claude.com/docs/en/hooks on 2026-10-27:

- HTTP hooks (`"type": "http"`) default to a **600 s** timeout.
- Failures (connection error, non-2xx, timeout) are **non-blocking by default**. `"onFailure": "block"` (Claude Code v2.1.295+) makes them fail closed.
- `permissionDecision` accepts `allow`, `deny`, `ask` and `defer`.
- `additionalContext` in `hookSpecificOutput` adds text to Claude's context on `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` and others. This makes Team Radio possible.
- There are 33 hook events, including `PermissionRequest`, which could support remote approval of permission prompts.

## Other agents

- **Codex CLI** supports remote MCP servers over streamable HTTP with a Bearer token (`[mcp_servers.<name>]` with `url` and `bearer_token_env_var` in `config.toml`). Sources: [Daniel Vaughan](https://codex.danielvaughan.com/2026/03/26/codex-cli-mcp-integration/), [DesignRevision](https://designrevision.com/blog/add-mcp-server-to-codex).
- A `.codex/hooks.json` file is mentioned, but support for a pre-tool hook is **unconfirmed**. Check the official Codex docs before planning Codex ingestion.
