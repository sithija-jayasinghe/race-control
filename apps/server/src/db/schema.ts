import {
  AGENTS,
  APPROVAL_STATUSES,
  AUTH_PROVIDERS,
  EVENT_DECISIONS,
  ROLES,
  RULE_ACTIONS,
  RULE_MODES,
  SESSION_STATUSES,
} from '@race-control/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Data model from docs/SPEC.md section 7.
//
// Team isolation: every team-owned table has `team_id`, and rows that point at
// other team-owned rows do so through `(team_id, id)` foreign keys. The database
// therefore rejects, for example, an event in team A that references a session in team B.

export const roleEnum = pgEnum('role', ROLES);
export const agentEnum = pgEnum('agent', AGENTS);
export const sessionStatusEnum = pgEnum('session_status', SESSION_STATUSES);
export const eventDecisionEnum = pgEnum('event_decision', EVENT_DECISIONS);
export const ruleActionEnum = pgEnum('rule_action', RULE_ACTIONS);
export const ruleModeEnum = pgEnum('rule_mode', RULE_MODES);
export const approvalStatusEnum = pgEnum('approval_status', APPROVAL_STATUSES);
export const authProviderEnum = pgEnum('auth_provider', AUTH_PROVIDERS);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const teams = pgTable('teams', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  'memberships',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

export const devTokens = pgTable(
  'dev_tokens',
  {
    id: id(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id').notNull(),
    // SHA-256 of the token. The token itself is shown once and never stored.
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // A token can only exist for a member of its team; removing the member removes their tokens.
    foreignKey({
      name: 'dev_tokens_membership_fk',
      columns: [t.teamId, t.userId],
      foreignColumns: [memberships.teamId, memberships.userId],
    }).onDelete('cascade'),
    // Listing a team's or a member's tokens, and cascading member removal.
    index('dev_tokens_team_user_idx').on(t.teamId, t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    agent: agentEnum('agent').notNull(),
    // The agent's own session id, e.g. Claude Code's `session_id`.
    agentSessionId: text('agent_session_id').notNull(),
    repoName: text('repo_name'),
    cwd: text('cwd'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: sessionStatusEnum('status').notNull().default('active'),
    // When the session's latest hook event arrived. The live team view sorts and fades by this.
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sessions_team_id_key').on(t.teamId, t.id),
    unique('sessions_agent_session_key').on(t.teamId, t.agent, t.agentSessionId),
    index('sessions_team_started_idx').on(t.teamId, t.startedAt.desc()),
    index('sessions_team_last_event_idx').on(t.teamId, t.lastEventAt.desc()),
  ],
);

export const events = pgTable(
  'events',
  {
    id: id(),
    teamId: uuid('team_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    // Hook event name, e.g. `PreToolUse`.
    type: text('type').notNull(),
    toolName: text('tool_name'),
    // Normalised file path or command the tool acted on. Used by rules, collisions and Team Radio.
    target: text('target'),
    summary: text('summary'),
    payloadRedacted: jsonb('payload_redacted').notNull().default({}),
    decision: eventDecisionEnum('decision').notNull().default('none'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'events_session_fk',
      columns: [t.teamId, t.sessionId],
      foreignColumns: [sessions.teamId, sessions.id],
    }).onDelete('cascade'),
    unique('events_team_id_key').on(t.teamId, t.id),
    index('events_team_created_idx').on(t.teamId, t.createdAt.desc()),
    index('events_session_created_idx').on(t.sessionId, t.createdAt),
    index('events_team_target_created_idx').on(t.teamId, t.target, t.createdAt.desc()),
  ],
);

export const rules = pgTable(
  'rules',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // `Bash`, `Edit`, `Write` or `*`.
    tool: text('tool').notNull(),
    pattern: text('pattern').notNull(),
    action: ruleActionEnum('action').notNull(),
    // New rules start in shadow mode (SPEC section 5).
    mode: ruleModeEnum('mode').notNull().default('shadow'),
    enabled: boolean('enabled').notNull().default(true),
    // Null for seeded starter rules, or if the author's account was deleted.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  // The (team_id, id) constraint also serves "all rules for a team" lookups.
  (t) => [unique('rules_team_id_key').on(t.teamId, t.id)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    teamId: uuid('team_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    eventId: uuid('event_id').notNull().unique(),
    ruleId: uuid('rule_id').notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    foreignKey({
      name: 'approvals_session_fk',
      columns: [t.teamId, t.sessionId],
      foreignColumns: [sessions.teamId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'approvals_event_fk',
      columns: [t.teamId, t.eventId],
      foreignColumns: [events.teamId, events.id],
    }).onDelete('cascade'),
    // Cascades so that deleting a team works. Deleting a rule also removes its approvals
    // (each event keeps its decision), so the rules UI should disable rules rather than delete them.
    foreignKey({
      name: 'approvals_rule_fk',
      columns: [t.teamId, t.ruleId],
      foreignColumns: [rules.teamId, rules.id],
    }).onDelete('cascade'),
    index('approvals_team_status_idx').on(t.teamId, t.status, t.requestedAt.desc()),
  ],
);

// Dashboard login (ADR 0002). These tables belong to people, not teams, so they have no `team_id`.
// Every secret (magic link, login cookie) is stored only as a SHA-256 hash.

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProviderEnum('provider').notNull(),
    // Lower-cased email for `email`; the provider's account id for GitHub and Google.
    providerUserId: text('provider_user_id').notNull(),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('auth_identities_provider_key').on(t.provider, t.providerUserId),
    index('auth_identities_user_idx').on(t.userId),
  ],
);

export const loginTokens = pgTable(
  'login_tokens',
  {
    id: id(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('login_tokens_email_created_idx').on(t.email, t.createdAt.desc())],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

// Invite links (SPEC section 3). Reusable until they expire or a lead revokes them.
export const invites = pgTable(
  'invites',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    role: roleEnum('role').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_team_created_idx').on(t.teamId, t.createdAt.desc())],
);
