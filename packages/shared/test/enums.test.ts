import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  APPROVAL_STATUSES,
  AUTH_PROVIDERS,
  EVENT_DECISIONS,
  ROLES,
  RULE_ACTIONS,
  RULE_MODES,
  SESSION_STATUSES,
  agentSchema,
  approvalStatusSchema,
  authProviderSchema,
  eventDecisionSchema,
  roleSchema,
  ruleActionSchema,
  ruleModeSchema,
  sessionStatusSchema,
} from '../src/index.ts';

const cases = [
  ['role', ROLES, roleSchema],
  ['auth provider', AUTH_PROVIDERS, authProviderSchema],
  ['agent', AGENTS, agentSchema],
  ['session status', SESSION_STATUSES, sessionStatusSchema],
  ['event decision', EVENT_DECISIONS, eventDecisionSchema],
  ['rule action', RULE_ACTIONS, ruleActionSchema],
  ['rule mode', RULE_MODES, ruleModeSchema],
  ['approval status', APPROVAL_STATUSES, approvalStatusSchema],
] as const;

describe.each(cases)('%s', (_name, values, schema) => {
  it('has no duplicate values', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('accepts every listed value', () => {
    for (const value of values) {
      expect(schema.parse(value)).toBe(value);
    }
  });

  it('rejects unknown and wrongly cased values', () => {
    expect(schema.safeParse('unknown').success).toBe(false);
    expect(schema.safeParse(values[0].toUpperCase()).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});
