# UI design

The "broadcast" direction, chosen on 2026-10-29 after reviewing a working prototype. Every screen follows this document; change it here first if a decision changes.

## Direction: an F1 broadcast of your agents

Race Control should feel like watching a race on the pit wall, not like reading a dashboard. Agents are live things you watch, not rows of labelled cards.

- **Dark first.** The default theme is dark; light and "follow system" are in the theme menu. Dark gets the polish; a full light-mode pass comes later.
- **The scene is the page.** A slowly turning 3D grid floor with drifting particles sits behind every screen. In Week 3 the live codebase map is drawn into it: folders as glowing clusters, files as points, agents as orbs that move to the files they touch and leave light trails.
- **Floating glass panels** over the scene: translucent, blurred, with a hairline edge. No boxed cards, no card titles, no helper text under everything.
- **Few labels.** Status is shown by colour, words in broadcast style, and motion. Names and details appear on hover, on selection, or in the side panel.
- **F1 broadcast language** for the signature moments: lights-out start, timing tower, Race Control messages, Team Radio, LIVE clock, kerb stripes.

## Brand

- **Wordmark:** "RACE / CONTROL" in Titillium Web 900 italic, with a red slash and a skewed checkered flag. Screen readers read "Race Control".
- **F1 red (`--f1`, #e10600)** is for the brand, the LIVE tag and kerb stripes only. It is never a status colour, so red status always means one thing.
- **Type:** Titillium Web (bold italic, upper case) for broadcast headlines; Geist for text; Geist Mono for codes, paths, commands and timestamps. All self-hosted.

## Status flags

Each status always has a word as well as a colour, so it never relies on colour alone.

| Status | Colour | Word | Where you see it |
|---|---|---|---|
| Working | Green | Working | Tower bar, orb glow |
| Collision | Yellow | Yellow flag | Banner, orb shockwave, Team Radio |
| Waiting for approval | Blue | Pit lane (`PIT` in the tower) | Banner, light beam above the orb, approval card |
| Blocked by a rule | Red | Black flag (`STOP` in the tower) | Banner, red pulse |
| Idle | Grey | Idle | Dimmed orb |

**Sector colours** (the three bars per tower row) show the last three actions: purple = tests passed, green = clean edit, yellow = collision, red = blocked.

## Broadcast pieces

| Piece | What it does |
|---|---|
| **Lights out** | Five pairs of red lights come on one by one, go out, and the page launches. Once per browser session, skippable with a click or any key, never shown with reduced motion |
| **Timing tower** | F1 TV-style leaderboard. Position, status bar, three-letter driver code, agent type (`CC`, `CDX`), sectors, and the gap: `LEAD`, `+n` laps, `PIT` or `STOP`. "Laps" are completed tool calls. Each row has a full spoken description |
| **Race Control banner** | Flag tag, "RACE CONTROL", message and file path, sliding in like the broadcast banner. On phones the source column and path are hidden |
| **Team Radio card** | Waveform, "TEAM RADIO NIM → KAS" and the heads-up as a quote |
| **LIVE clock** | Red LIVE tag and elapsed session time |
| **Counters** | Glowing dots and numbers for each status in the top bar, with the words for screen readers |
| **Approval card** | Blue kerb stripe, who wants to do what, a countdown to auto-deny, Deny and Approve (Week 4) |
| **Command palette** | ⌘K to jump to any agent, file or rule (added when there is something to jump to) |

## Who's on the track

- Every working session that reported in the last 2 hours.
- Plus each person's latest idle session, for 10 minutes, only if they have nothing working. Finished sessions don't crowd the tower.
- **Laps** are tool calls. **Sectors** are the last three outcomes: purple = tests passed, green = clean, red = failed or blocked.
- **Yellow flag:** two working agents whose latest file is the same, touched within 30 minutes.
- On phones the map is hidden; the tower and the session list remain.

## Layout

```text
Desktop                                              Phone
┌──┬───────────────────────────────────────────┐     ┌──────────────────────┐
│◎ │ RACE/CONTROL  team     ● 3 ● 1 ● 1  LIVE ☾ │     │ RACE/CONTROL      ☾  │
│  │┌──────────┐      [YELLOW FLAG | RACE ...]  │     │┌────────────────────┐│
│☰ ││ PIT WALL │                                │     ││ PIT WALL   tower   ││
│  ││ 1 NIM    │        3D scene                │     │└────────────────────┘│
│✋ ││ 2 KAS    │                         ┌─────┐│     │  [YELLOW FLAG | ...] │
│  │└──────────┘                         │agent││     │                      │
│⚑ │                                     │panel││     │  [team radio]        │
│⚙ │             [team radio]            └─────┘│     │ ┌──────────────────┐ │
└──┴───────────────────────────────────────────┘     │ │  ◎    ☰    ⚙     │ │
                                                     └─┴──────────────────┴─┘
```

- **Desktop:** a thin floating icon rail with tooltips; a top bar with the wordmark, team, counters, LIVE clock and theme menu.
- **Phone:** the same top bar without counters; a floating glass tab bar with icons; the tower goes full width above the scene.
- Navigation items for later weeks (Sessions, Approvals, Rules) appear only once they're built. Everything team-specific lives under `/t/:teamId/...`.
- Every screen works from 360 px wide, with no horizontal scrolling and tap targets of at least 44 px.

## Building blocks

- **Tailwind CSS** with the tokens in `apps/web/src/index.css`, plus three utilities: `glass`, `broadcast` and `kerb`.
- **shadcn/ui** (Radix) only for the behaviour of plain controls: buttons, inputs, menus, dialogs. Restyled to glass; never the stock card look.
- **Icons:** Lucide, outline.
- **Motion:** CSS and canvas only, no animation library for now.

## Motion and accessibility

- `prefers-reduced-motion` turns off the lights-out start, scene rotation, trails and banner slides.
- WCAG AA contrast for text in both themes. Full keyboard use with visible focus rings.
- Status is never shown by colour alone: the tower has `PIT` and `STOP` words and spoken row descriptions, and banners always name the flag.
- Live updates announce Race Control messages and Team Radio politely to screen readers, not every event.

## Every screen has four states

1. **Loading:** skeleton shapes in glass, not spinners, for anything over 300 ms.
2. **Empty:** an invitation with one action. The empty Pit wall is an empty track: "No cars on track yet", with the steps to connect an agent.
3. **Error:** what happened, plus a retry or a way out.
4. **Ready.**

## Screens and when they're built

| Screen | Route | Week |
|---|---|---|
| Sign in, check your email | `/sign-in` | 1 |
| Link landing | `/auth/verify#token=…` | 1 |
| Invite | `/invite#token=…` | 1 |
| Create your team | `/start` | 1 |
| Pit wall (Week 1: empty track, connect checklist, and a demo race at `?demo=1`) | `/t/:teamId` | 1, live map in Week 3 |
| Team: members and invite links | `/t/:teamId/team` | 1 |
| Settings: your tokens, theme | `/t/:teamId/settings` | 1 |
| Session timeline | `/t/:teamId/sessions/:id` | 3 |
| Rules | `/t/:teamId/rules` | 4 |
| Approvals queue and approval card | `/t/:teamId/approvals`, `/t/:teamId/approvals/:id` | 4 |

The prototype this direction came from is [pit-wall-prototype.html](pit-wall-prototype.html). Open it in a browser to see the live map, flags, Team Radio and approval flow with sample agents. The Week 3 live map is built from it.
