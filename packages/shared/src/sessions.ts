import { z } from 'zod';
import { agentSchema, sessionStatusSchema } from './enums.ts';

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
