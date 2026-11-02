import { posix } from 'node:path';
import { commandParts, type RuleAction, type RuleMode } from '@race-control/shared';

// Rule matching (SPEC section 5). Patterns are wildcards, never user-written regular expressions, and
// are matched by a small dynamic-programming loop that takes time proportional to pattern × text, so
// no pattern a lead writes can make the hook endpoint hang.

export type MatchableRule = {
  id: string;
  name: string;
  tool: string;
  pattern: string;
  action: RuleAction;
  mode: RuleMode;
  enabled: boolean;
  createdAt: Date;
};

/** What a tool call is matched on: the repo-relative path for file tools, the raw command for Bash. */
export type ToolCall = { toolName: string; target: string | null; command: string | null };

type Token =
  | { kind: 'char'; char: string }
  /** `?`: one character (not `/` in a path). */
  | { kind: 'one' }
  /** `*` in a path: any run of characters within one folder. */
  | { kind: 'segment' }
  /** `**`, or `*` in a command: any run of characters. */
  | { kind: 'any' }
  /** `**` then `/` in a path: nothing, or any folders. */
  | { kind: 'dirs' };

function tokenize(pattern: string, path: boolean): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '?') tokens.push({ kind: 'one' });
    else if (char !== '*') tokens.push({ kind: 'char', char });
    else if (!path) {
      // Runs of `*` in a command mean the same as one.
      while (pattern[i + 1] === '*') i++;
      tokens.push({ kind: 'any' });
    } else if (pattern[i + 1] !== '*') tokens.push({ kind: 'segment' });
    else {
      while (pattern[i + 1] === '*') i++;
      if (pattern[i + 1] === '/') {
        i++;
        tokens.push({ kind: 'dirs' });
      } else tokens.push({ kind: 'any' });
    }
  }
  return tokens;
}

/** True if `pattern` matches all of `text`. `path` decides whether `*` and `?` stop at `/`. */
export function wildcardMatch(pattern: string, text: string, path: boolean): boolean {
  const n = text.length;
  // reach[j]: the tokens so far can match exactly the first j characters.
  let reach = new Uint8Array(n + 1);
  reach[0] = 1;
  for (const token of tokenize(pattern, path)) {
    const next = new Uint8Array(n + 1);
    let seen = 0;
    for (let j = 0; j <= n; j++) {
      const prev = j > 0 ? text[j - 1]! : '';
      switch (token.kind) {
        case 'char':
          if (j > 0 && reach[j - 1] && prev === token.char) next[j] = 1;
          break;
        case 'one':
          if (j > 0 && reach[j - 1] && (!path || prev !== '/')) next[j] = 1;
          break;
        case 'any':
          seen |= reach[j]!;
          next[j] = seen;
          break;
        case 'segment':
          next[j] = reach[j] || (j > 0 && next[j - 1] && prev !== '/') ? 1 : 0;
          break;
        case 'dirs':
          // Nothing, or anything that ends in `/` after a point the pattern had reached.
          next[j] = reach[j] || (prev === '/' && seen) ? 1 : 0;
          seen |= reach[j]!;
          break;
      }
    }
    reach = next;
  }
  return reach[n] === 1;
}

function toolMatches(ruleTool: string, toolName: string): boolean {
  return ruleTool.split('|').some((tool) => {
    const name = tool.trim();
    return name === '*' || name === toolName;
  });
}

/** What a rule's pattern is checked against: each command in a Bash chain, or the one file. */
function subjects(call: ToolCall): { texts: string[]; path: boolean } {
  if (call.toolName === 'Bash') return { texts: call.command === null ? [] : commandParts(call.command), path: false };
  // `src/../.env` is still `.env`.
  return { texts: call.target === null ? [] : [posix.normalize(call.target)], path: true };
}

export function ruleMatches(rule: MatchableRule, call: ToolCall): boolean {
  if (!rule.enabled || !toolMatches(rule.tool, call.toolName)) return false;
  const { texts, path } = subjects(call);
  return texts.some((text) => wildcardMatch(rule.pattern, text, path));
}

export type Evaluation<R extends MatchableRule = MatchableRule> = {
  /** Shadow rules that matched: recorded, never acted on. */
  shadow: R[];
  /** The enforced rule that decides, if any. */
  enforced?: R;
};

const oldestFirst = (a: MatchableRule, b: MatchableRule) => a.createdAt.getTime() - b.createdAt.getTime();

/**
 * Checks a tool call against a team's rules. Of the enforced rules that match, a block always wins. Then
 * an approval is needed for any command in a chain (or the file) that an approve rule matches and no allow
 * rule does, so allowing `npm test` never lets `npm test && npm publish` through. Otherwise an allow rule
 * decides. Within each action the oldest rule wins.
 */
export function evaluateRules<R extends MatchableRule>(rules: R[], call: ToolCall): Evaluation<R> {
  const matched = rules.filter((rule) => ruleMatches(rule, call)).sort(oldestFirst);
  const shadow = matched.filter((rule) => rule.mode === 'shadow');
  const enforced = matched.filter((rule) => rule.mode === 'enforce');

  const block = enforced.find((rule) => rule.action === 'block');
  if (block) return { shadow, enforced: block };

  const allows = enforced.filter((rule) => rule.action === 'allow');
  const { texts, path } = subjects(call);
  const uncovered = texts.filter((text) => !allows.some((rule) => wildcardMatch(rule.pattern, text, path)));
  const approve = enforced.find((rule) => rule.action === 'approve' && uncovered.some((text) => wildcardMatch(rule.pattern, text, path)));
  return { shadow, enforced: approve ?? allows[0] };
}
