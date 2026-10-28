import { z } from 'zod';
import { roleSchema } from './enums.ts';

// Request and response bodies for the dashboard login API.

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const magicLinkRequestSchema = z.object({ email: emailSchema });
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

export const verifyMagicLinkRequestSchema = z.object({
  token: z.string().min(1).max(200),
});
export type VerifyMagicLinkRequest = z.infer<typeof verifyMagicLinkRequestSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const meResponseSchema = z.object({
  user: userSchema,
  teams: z.array(z.object({ id: z.uuid(), name: z.string(), role: roleSchema })),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
