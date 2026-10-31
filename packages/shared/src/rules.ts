import { z } from 'zod';
import { ruleActionSchema, ruleModeSchema } from './enums.ts';
import { teamParamsSchema } from './teams.ts';

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

/** A team can have at most this many rules. */
export const MAX_RULES = 100;

/** `Edit`, `Edit|Write`, `mcp__github__create_issue`, or `*`. */
const toolSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^(\*|[A-Za-z][\w.-]*(\s*\|\s*[A-Za-z][\w.-]*)*)$/, 'Use tool names joined with |, or *')
  .transform((tool) => tool.replace(/\s*\|\s*/g, '|'));

/** Printable text only: patterns and names never carry control characters. */
const printable = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !/\p{Cc}/u.test(text), 'No control characters');

export const ruleInputSchema = z.object({
  name: printable(100),
  tool: toolSchema,
  pattern: printable(300),
  action: ruleActionSchema,
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** Any of a rule's fields. New rules always start in shadow mode; this is how they go live. */
export const ruleUpdateSchema = ruleInputSchema
  .extend({ mode: ruleModeSchema, enabled: z.boolean() })
  .partial()
  .refine((update) => Object.keys(update).length > 0, 'Nothing to change');
export type RuleUpdate = z.infer<typeof ruleUpdateSchema>;

export const ruleParamsSchema = teamParamsSchema.extend({ ruleId: z.uuid() });

/** A rule on the Rules page, with how often it matched each day, oldest of the last 7 days first. */
export const ruleWithStatsSchema = ruleSchema.extend({ matches: z.array(z.number().int().nonnegative()).length(7) });
export type RuleWithStats = z.infer<typeof ruleWithStatsSchema>;

/** The test lane: a file path, or a command (anything with a space in it). */
export const ruleTestRequestSchema = z.object({ input: z.string().trim().min(1).max(2000) });

export const ruleTestResultSchema = z.object({
  /** What Race Control would answer: `none` lets it through. */
  decision: z.enum(['none', 'deny', 'ask']),
  /** The enforced rule that decides. */
  ruleId: z.uuid().nullable(),
  /** Shadow rules that would have matched. */
  shadowIds: z.array(z.uuid()),
});
export type RuleTestResult = z.infer<typeof ruleTestResultSchema>;

/** The new-rule drawer's preview: how often a rule would have matched the team's recent tool calls. */
export const rulePreviewRequestSchema = z.object({ tool: toolSchema, pattern: printable(300) });

export const rulePreviewSchema = z.object({
  count: z.number().int().nonnegative(),
  /** Up to three different files or commands it would have caught. */
  examples: z.array(z.string()),
});
export type RulePreview = z.infer<typeof rulePreviewSchema>;
