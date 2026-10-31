import { z } from 'zod';
import { agentSchema, approvalStatusSchema } from './enums.ts';
import { teamParamsSchema } from './teams.ts';

/** How long an agent waits for a lead before Race Control denies the action (SPEC section 5). */
export const APPROVAL_WAIT_MS = 4 * 60 * 1000;

/** A held tool call waiting for, or decided by, a lead. Only redacted metadata. */
export const approvalSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  eventId: z.uuid(),
  status: approvalStatusSchema,
  ruleId: z.uuid(),
  ruleName: z.string(),
  /** Whose agent wants to act. */
  userId: z.uuid(),
  userEmail: z.string(),
  userName: z.string().nullable(),
  agent: agentSchema,
  repoName: z.string().nullable(),
  toolName: z.string().nullable(),
  /** The file or (redacted) command. */
  target: z.string().nullable(),
  summary: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  /** When Race Control denies it if nobody answers. */
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  /** The lead who decided. Null while pending, or when it expired. */
  decidedBy: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalParamsSchema = teamParamsSchema.extend({ approvalId: z.uuid() });

export const approvalDecisionSchema = z.object({ decision: z.enum(['approve', 'deny']) });
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
