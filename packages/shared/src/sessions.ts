import { z } from 'zod';
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

/** Messages on a team's live channel (`/teams/:teamId/live`). */
export const liveMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), teamId: z.uuid() }),
  z.object({ type: z.literal('session'), session: agentSessionSchema }),
  z.object({ type: z.literal('event'), event: liveEventSchema }),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;
