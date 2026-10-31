import { z } from 'zod';
import { approvalSchema } from './approvals.ts';
import { agentSchema, eventDecisionSchema, sessionStatusSchema } from './enums.ts';

/** An agent session as listed to team members. */
export const agentSessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userEmail: z.string(),
  userName: z.string().nullable(),
  agent: agentSchema,
  repoName: z.string().nullable(),
  status: sessionStatusSchema,
  startedAt: z.iso.datetime(),
  lastEventAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** The latest event's one-line summary, e.g. "edit src/app.ts". */
  lastAction: z.string().nullable(),
  /** Tool calls so far (PreToolUse events): the session's "laps" on the timing tower. */
  toolCalls: z.number().int().nonnegative(),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;

export const hookSetupSchema = z.object({
  /** Where agents send hooks, e.g. `https://racecontrol.example/hooks`. */
  hooksUrl: z.url(),
});
export type HookSetup = z.infer<typeof hookSetupSchema>;

/** One recorded hook event, as the live feed and timelines show it. Only redacted metadata. */
export const liveEventSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  /** Hook event name, e.g. `PreToolUse`. */
  type: z.string(),
  toolName: z.string().nullable(),
  target: z.string().nullable(),
  summary: z.string().nullable(),
  decision: eventDecisionSchema,
  createdAt: z.iso.datetime(),
});
export type LiveEvent = z.infer<typeof liveEventSchema>;

/** Edit tools: two people editing the same file is a yellow flag. Reads never are. */
export const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'] as const;

/** A person in a yellow flag: their latest session on the file, and when it last edited it. */
export const flagDriverSchema = z.object({
  sessionId: z.uuid(),
  userId: z.uuid(),
  userEmail: z.string(),
  userName: z.string().nullable(),
  agent: agentSchema,
  lastAt: z.iso.datetime(),
});

/** Two or more people on a team edited the same file in the same repo recently. */
export const yellowFlagSchema = z.object({
  /** Stable per file: `repo:path`. */
  id: z.string(),
  repoName: z.string(),
  target: z.string(),
  /** Most recent edit first. */
  drivers: z.array(flagDriverSchema).min(2),
  /** When the flag clears unless someone edits the file again. */
  expiresAt: z.iso.datetime(),
});
export type YellowFlag = z.infer<typeof yellowFlagSchema>;

/**
 * Tools that get a Team Radio heads-up about someone else's recent edit. Reads count: Claude Code reads a
 * file before editing it, and a heads-up arrives with the tool's result, so the read is where it helps.
 */
export const TEAM_RADIO_TOOLS = [...EDIT_TOOLS, 'Read'] as const;

/** Race Control told an agent that other people recently edited the file it's working on. */
export const teamRadioSchema = z.object({
  /** The tool call that carried the heads-up. */
  eventId: z.uuid(),
  /** The session that heard it. */
  sessionId: z.uuid(),
  repoName: z.string(),
  target: z.string(),
  /** Who edited the file, most recent first. */
  about: z.array(flagDriverSchema).min(1),
  createdAt: z.iso.datetime(),
});
export type TeamRadio = z.infer<typeof teamRadioSchema>;

/** Messages on a team's live channel (`/teams/:teamId/live`). */
export const liveMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), teamId: z.uuid() }),
  z.object({ type: z.literal('session'), session: agentSessionSchema }),
  z.object({ type: z.literal('event'), event: liveEventSchema }),
  z.object({ type: z.literal('flag'), flag: yellowFlagSchema }),
  z.object({ type: z.literal('radio'), radio: teamRadioSchema }),
  /** An approval was requested, decided or expired. */
  z.object({ type: z.literal('approval'), approval: approvalSchema }),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;

/** A timeline step: an event plus one short, already-redacted detail (an error's first line, a session's end reason). */
export const timelineEventSchema = liveEventSchema.extend({
  detail: z.string().nullable(),
  /** Names of the people a Team Radio heads-up on this step was about, if it carried one. */
  radio: z.array(z.string()).nullable(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const sessionParamsSchema = z.object({ teamId: z.uuid(), sessionId: z.uuid() });

export const sessionTimelineSchema = z.object({
  session: agentSessionSchema,
  events: z.array(timelineEventSchema),
  /** True when the session has more events than were returned (only the latest are sent). */
  truncated: z.boolean(),
});
export type SessionTimeline = z.infer<typeof sessionTimelineSchema>;
