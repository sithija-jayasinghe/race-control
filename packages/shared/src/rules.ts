import { z } from 'zod';
import { ruleActionSchema, ruleModeSchema } from './enums.ts';

/** A team guardrail (SPEC section 5). */
export const ruleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** One tool, several joined with `|` (`Edit|Write`), or `*` for any tool. */
  tool: z.string(),
  /**
   * A wildcard pattern. For file tools it matches the repo-relative path: `*` stays within a folder,
   * `**` crosses folders, `?` is one character. For Bash it matches each command in a chain
   * (`a && b; c | d`) as a whole, and `*` matches anything.
   */
  pattern: z.string(),
  action: ruleActionSchema,
  mode: ruleModeSchema,
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Rule = z.infer<typeof ruleSchema>;

export type StarterRule = Pick<Rule, 'name' | 'tool' | 'pattern' | 'action'>;

const FILE_EDITS = 'Edit|MultiEdit|Write|NotebookEdit';

/** Seeded for every new team, in shadow mode, so a lead sees what they'd catch before turning them on. */
export const STARTER_RULES: StarterRule[] = [
  { name: 'Never touch .env files', tool: FILE_EDITS, pattern: '**/.env*', action: 'block' },
  { name: 'No rm -rf /', tool: 'Bash', pattern: 'rm -rf /', action: 'block' },
  { name: 'No force push to main', tool: 'Bash', pattern: 'git push*-f*main*', action: 'block' },
  { name: 'Migrations need a lead', tool: FILE_EDITS, pattern: '**/migrations/**', action: 'approve' },
  { name: 'Publishing needs a lead', tool: 'Bash', pattern: 'npm publish*', action: 'approve' },
];
