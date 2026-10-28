import { z } from 'zod';

// Value lists shared by the database schema, the API and the web app.
// See docs/SPEC.md section 7 for what each one means.

export const ROLES = ['lead', 'developer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

// Ways a person signs in to the dashboard. Passkeys are stored separately.
export const AUTH_PROVIDERS = ['email', 'github', 'google'] as const;
export const authProviderSchema = z.enum(AUTH_PROVIDERS);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const AGENTS = ['claude_code', 'codex'] as const;
export const agentSchema = z.enum(AGENTS);
export type Agent = z.infer<typeof agentSchema>;

export const SESSION_STATUSES = ['active', 'idle', 'ended'] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

// `none` means Race Control returned no decision; `pending` means an approval is open.
export const EVENT_DECISIONS = ['allow', 'deny', 'ask', 'none', 'pending'] as const;
export const eventDecisionSchema = z.enum(EVENT_DECISIONS);
export type EventDecision = z.infer<typeof eventDecisionSchema>;

export const RULE_ACTIONS = ['block', 'approve'] as const;
export const ruleActionSchema = z.enum(RULE_ACTIONS);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const RULE_MODES = ['enforce', 'shadow'] as const;
export const ruleModeSchema = z.enum(RULE_MODES);
export type RuleMode = z.infer<typeof ruleModeSchema>;

export const APPROVAL_STATUSES = ['pending', 'approved', 'denied', 'expired'] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
