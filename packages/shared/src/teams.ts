import { z } from 'zod';
import { roleSchema } from './enums.ts';

// Request and response bodies for teams, members and invites.

export const teamParamsSchema = z.object({ teamId: z.uuid() });

export const createTeamRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

/** A team as seen by one of its members. */
export const myTeamSchema = z.object({ id: z.uuid(), name: z.string(), role: roleSchema });
export type MyTeam = z.infer<typeof myTeamSchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: roleSchema,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberParamsSchema = teamParamsSchema.extend({ userId: z.uuid() });

export const updateMemberRequestSchema = z.object({ role: roleSchema });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const createInviteRequestSchema = z.object({ role: roleSchema.default('developer') });
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

/** An invite as listed to leads. Never includes the link itself. */
export const inviteSchema = z.object({
  id: z.uuid(),
  role: roleSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof inviteSchema>;

/** Returned once, when the invite is created. */
export const createdInviteSchema = inviteSchema.extend({ url: z.url() });
export type CreatedInvite = z.infer<typeof createdInviteSchema>;

export const inviteParamsSchema = teamParamsSchema.extend({ inviteId: z.uuid() });

export const inviteTokenRequestSchema = z.object({ token: z.string().min(1).max(200) });
export type InviteTokenRequest = z.infer<typeof inviteTokenRequestSchema>;

export const invitePreviewSchema = z.object({
  teamName: z.string(),
  role: roleSchema,
  expiresAt: z.iso.datetime(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
