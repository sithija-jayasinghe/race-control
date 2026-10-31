import type { DbOrTx } from '../../db/client.ts';
import type { MatchableRule } from './match.ts';
import { listEnabledRules } from './repo.ts';

/** Even without a change through this server (say, the simulator editing rules), rules reload this often. */
export const RULE_CACHE_MS = 30_000;

/**
 * Each team's enabled rules, kept in memory so the hook endpoint doesn't query them on every tool call.
 * Changing a team's rules must call `invalidate`.
 */
export class RuleCache {
  private readonly teams = new Map<string, { rules: Promise<MatchableRule[]>; loadedAt: number }>();

  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
  }

  get(db: DbOrTx, teamId: string): Promise<MatchableRule[]> {
    const now = this.now().getTime();
    const cached = this.teams.get(teamId);
    if (cached && now - cached.loadedAt < RULE_CACHE_MS) return cached.rules;
    const entry = { rules: listEnabledRules(db, teamId), loadedAt: now };
    this.teams.set(teamId, entry);
    // A failed load isn't kept, so the next call tries again.
    entry.rules.catch(() => {
      if (this.teams.get(teamId) === entry) this.teams.delete(teamId);
    });
    return entry.rules;
  }

  invalidate(teamId: string) {
    this.teams.delete(teamId);
  }
}
