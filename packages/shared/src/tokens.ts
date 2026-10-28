import { z } from 'zod';
import { teamParamsSchema } from './teams.ts';

// Developer tokens: what a developer's agent hooks send as `Authorization: Bearer <token>`.

/** Every developer token starts with this, so scanners and our own redaction can spot them. */
export const DEV_TOKEN_PREFIX = 'rc_';

export const createDevTokenRequestSchema = z.object({
  label: z.string().trim().min(1).max(60),
});
export type CreateDevTokenRequest = z.infer<typeof createDevTokenRequestSchema>;

/** A token as listed. Never includes the token itself. */
export const devTokenSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  userId: z.uuid(),
  userEmail: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type DevToken = z.infer<typeof devTokenSchema>;

/** Returned once, when the token is created. */
export const createdDevTokenSchema = devTokenSchema.extend({ token: z.string() });
export type CreatedDevToken = z.infer<typeof createdDevTokenSchema>;

export const devTokenParamsSchema = teamParamsSchema.extend({ tokenId: z.uuid() });
