# UI design

Decisions from the UI brainstorm on 2026-10-29. Every screen follows this document; change it here first if a decision changes.

## Direction: hybrid

- **Clean base:** calm surfaces, plenty of whitespace, plain sans-serif text. Readable on a phone in daylight.
- **Light and dark themes**, following the system setting, with a manual switch in settings.
- **F1 shows up as status, not decoration.** Flag colours mark what an agent is doing. No checkered patterns, racing stripes or speed effects.
- **Monospace for machine things:** commands, file paths, repo names, timestamps in feeds. Everything else is sans-serif.

## Wording: light touch

F1 names only for the signature features. Plain words everywhere else.

| Use the F1 name | Use the plain word |
|---|---|
| Pit wall (the live team view) | Sessions, not "laps" |
| Team Radio (agent heads-ups) | Developers, not "drivers" |
| Yellow flag (two agents on one file) | Rules, not "stewards" |
| | Approvals, Members, Settings |

Voice: short, direct, sentence case, no exclamation marks. Buttons start with a verb ("Create team", "Copy link"). Errors say what happened and what to do next ("That link has expired. Ask your lead for a new one.").

## Status colours (flags)

The only strong colours in the product. Each status always shows an **icon and a word as well as the colour**, so it never relies on colour alone.

| Status | Flag | Meaning |
|---|---|---|
| Working | Green | Agent is running tools |
| Yellow flag | Yellow | Another agent touched the same file recently |
| Waiting | Blue | Held for a lead's approval |
| Blocked | Red | A rule denied the action |
| Idle | Grey | No activity for 5 minutes, or the session ended |

The tokens are defined once, for both themes: `--flag-{green,yellow,blue,red,idle}`, each with a `-bg` and a `-text` pair. Primary buttons are neutral (near-black in light, near-white in dark), so they never compete with the flags.

## Layout and navigation

```text
Desktop                                   Phone
┌──────────┬──────────────────────────┐   ┌────────────────────┐
│ Team ▾   │                          │   │ Team ▾        (•)  │
│          │   page content           │   │                    │
│ Pit wall │                          │   │   page content     │
│ Sessions │                          │   │                    │
│ Approvals│ (3)                      │   ├────────────────────┤
│ Rules    │                          │   │ Pit  Sess  ✋  Rules  ⋯ │
│ Team     │                          │   └────────────────────┘
│ Settings │                          │     Approvals in the middle
└──────────┴──────────────────────────┘
```

- A team switcher at the top. Everything else is scoped to the selected team: `/t/:teamId/...`.
- Approvals shows a count badge when anything is waiting.
- Navigation items for later weeks (Sessions, Approvals, Rules) appear only once they're built.

## Device priority, by screen

| Designed for the phone first | Designed for desktop first |
|---|---|
| Sign in, check email, link landing | Pit wall |
| Invite page | Session timeline |
| Approval card | Rules |
| Team and settings (simple lists, so they work on both) | |

Every screen works from 360 px wide upwards, with no horizontal scrolling. Tap targets are at least 44 px.

## Building blocks

- **Tailwind CSS** for styling, with the tokens above defined as CSS variables.
- **shadcn/ui** components (built on Radix), copied into `apps/web/src/components/ui` so we own and restyle them.
- **Icons:** Lucide (shadcn's default set).
- **Fonts:** Inter for text, JetBrains Mono for machine text. Both self-hosted, so the app loads no third-party fonts.

## Every screen has four states

1. **Loading:** skeleton shapes, not spinners, for anything that takes more than 300 ms.
2. **Empty:** an invitation with one action ("Invite your team", "Create your first token"), never just "Nothing here".
3. **Error:** what happened, plus a retry or a way out.
4. **Ready.**

## Accessibility

- WCAG AA contrast in both themes.
- Full keyboard use, with visible focus rings.
- Status is never shown by colour alone.
- The live feed announces new blocked actions and approvals politely to screen readers, not every event.

## Screens and when they're built

| Screen | Route | Week |
|---|---|---|
| Sign in | `/sign-in` | 1 |
| Check your email | `/sign-in` (after submitting) | 1 |
| Link landing | `/auth/verify#token=…` | 1 |
| Invite | `/invite#token=…` | 1 |
| Create your first team | `/start` | 1 |
| Pit wall (Week 1: a "Connect your agent" checklist) | `/t/:teamId` | 1, filled in Week 3 |
| Team: members and invite links | `/t/:teamId/team` | 1 |
| Settings: your tokens, theme | `/t/:teamId/settings` | 1 |
| Session timeline | `/t/:teamId/sessions/:id` | 3 |
| Rules | `/t/:teamId/rules` | 4 |
| Approvals queue and approval card | `/t/:teamId/approvals`, `/t/:teamId/approvals/:id` | 4 |

## Pit wall (Week 3 preview)

One card per developer, sorted with problems first: blocked, then waiting, then yellow flag, then working, then idle. Each card shows the developer, the agent, the repo, a status flag, the current action, and the last three steps. A live feed runs down the right on desktop and becomes its own tab on a phone.

## Approval card (Week 4 preview)

Opened from a link in a notification. It shows who wants to do what (the command or file path in monospace), the rule that fired, and a countdown to auto-deny. Two large buttons, Deny and Approve, plus "Always allow this" as a quieter link.
