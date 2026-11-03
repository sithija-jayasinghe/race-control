import { z } from 'zod';
import { myTeamSchema } from './teams.ts';

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
  teams: z.array(myTeamSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Sign-in methods besides the email link that this server has switched on. */
export const SIGN_IN_PROVIDERS = ['github', 'google'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];
export const authProvidersResponseSchema = z.object({ providers: z.array(z.enum(SIGN_IN_PROVIDERS)) });

/**
 * Why GitHub or Google sign-in didn't work, sent back to `/sign-in?error=`: the person said no, the attempt
 * ran out or was tampered with, the provider has no verified email for them, or the provider failed.
 */
export const SIGN_IN_ERRORS = ['cancelled', 'expired', 'no_verified_email', 'failed'] as const;
export type SignInError = (typeof SIGN_IN_ERRORS)[number];

export const errorResponseSchema = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
