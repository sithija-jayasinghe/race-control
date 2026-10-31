import { EDIT_TOOLS, type RulePreview, type RuleTestResult, type RuleWithStats } from '@race-control/shared';
import type { DbOrTx } from '../../db/client.ts';
import { evaluateRules, ruleMatches, type MatchableRule } from './match.ts';
import { listEnabledRules, listRecentToolCalls, listRuleMatches, listRules } from './repo.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const STATS_DAYS = 7;

export function serializeRule(rule: MatchableRule) {
  return { ...rule, createdAt: rule.createdAt.toISOString() };
}

/** A team's rules with how often each matched in each of the last 7 days (counted back from now). */
export async function listRulesWithStats(db: DbOrTx, teamId: string, now: Date): Promise<RuleWithStats[]> {
  const since = new Date(now.getTime() - STATS_DAYS * DAY_MS);
  const [rules, matches] = await Promise.all([listRules(db, teamId), listRuleMatches(db, teamId, since)]);
  const counts = new Map(rules.map((rule) => [rule.id, new Array<number>(STATS_DAYS).fill(0)]));
  for (const event of matches) {
    const day = STATS_DAYS - 1 - Math.min(STATS_DAYS - 1, Math.floor((now.getTime() - event.createdAt.getTime()) / DAY_MS));
    const ids = [event.rule?.id, ...(Array.isArray(event.shadow) ? event.shadow.map((s) => s.id) : [])];
    for (const id of ids) {
      const days = id ? counts.get(id) : undefined;
      if (days) days[day]!++;
    }
  }
  return rules.map((rule) => ({ ...serializeRule(rule), matches: counts.get(rule.id)! }));
}

const strictness = { none: 0, ask: 1, deny: 2 } as const;

/**
 * The test lane: what Race Control would do with a command (anything with a space) or an edit to a file.
 * A file is checked as every edit tool, and the strictest answer wins.
 */
export async function testRules(db: DbOrTx, teamId: string, input: string): Promise<RuleTestResult> {
  const rules = await listEnabledRules(db, teamId);
  const calls = /\s/.test(input)
    ? [{ toolName: 'Bash', target: input, command: input }]
    : EDIT_TOOLS.map((toolName) => ({ toolName, target: input, command: null }));

  let result: RuleTestResult = { decision: 'none', ruleId: null, shadowIds: [] };
  const shadowIds = new Set<string>();
  for (const call of calls) {
    const { enforced, shadow } = evaluateRules(rules, call);
    for (const rule of shadow) shadowIds.add(rule.id);
    const decision = !enforced ? 'none' : enforced.action === 'block' ? 'deny' : 'ask';
    if (strictness[decision] > strictness[result.decision]) result = { decision, ruleId: enforced!.id, shadowIds: [] };
  }
  return { ...result, shadowIds: [...shadowIds] };
}

/** How often a rule would have matched the team's tool calls in the last 7 days, with a few examples. */
export async function previewRule(db: DbOrTx, teamId: string, rule: { tool: string; pattern: string }, now: Date): Promise<RulePreview> {
  const candidate: MatchableRule = { ...rule, id: 'preview', name: 'preview', action: 'block', mode: 'enforce', enabled: true, createdAt: now };
  const calls = await listRecentToolCalls(db, teamId, new Date(now.getTime() - STATS_DAYS * DAY_MS));
  let count = 0;
  const examples = new Set<string>();
  for (const { toolName, target } of calls) {
    // Stored commands are already redacted, so examples never show a secret.
    if (!ruleMatches(candidate, { toolName: toolName!, target, command: toolName === 'Bash' ? target : null })) continue;
    count++;
    if (examples.size < 3) examples.add(target!);
  }
  return { count, examples: [...examples] };
}
