import type { RuleAction, RuleTestResult, RuleWithStats } from '@race-control/shared';
import { FlagTriangleRight, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { ApiError } from '@/lib/api';
import { useAddStarterRules, useCreateRule, useRulePreview, useRules, useRuleTest, useUpdateRule } from '@/lib/rules';
import { cn } from '@/lib/utils';
import { primaryButton, quietButton } from '@/pages/sign-in';
import { useTeamContext } from '@/routes';

// The Rules page (docs/design/UI.md): a test lane, the rules as STOP and PIT rows (shadow rules are
// ghosts), and a drawer to add or edit one. Developers see it all; only leads change anything.

/** The tool chips, and the tools each one stands for. */
const CHIPS = [
  { key: 'Edit', label: 'Edit', tools: ['Edit', 'MultiEdit', 'NotebookEdit'] },
  { key: 'Write', label: 'Write', tools: ['Write'] },
  { key: 'Bash', label: 'Bash', tools: ['Bash'] },
  { key: '*', label: 'Any', tools: ['*'] },
] as const;
type ChipKey = (typeof CHIPS)[number]['key'];

/** Splits a rule's tool list into chips, keeping tools no chip covers (an MCP tool, say). */
export function toolsToChips(tool: string): { chips: ChipKey[]; extra: string[] } {
  const names = tool.split('|').map((t) => t.trim());
  const chips = CHIPS.filter((chip) => chip.tools.some((t) => names.includes(t))).map((chip) => chip.key);
  const covered = new Set<string>(CHIPS.flatMap((chip) => chip.tools));
  return { chips, extra: names.filter((name) => name && !covered.has(name)) };
}

export function chipsToTool(chips: ChipKey[], extra: string[] = []): string {
  if (chips.includes('*')) return '*';
  return [...CHIPS.filter((chip) => chips.includes(chip.key)).flatMap((chip) => chip.tools), ...extra].join('|');
}

const FLAG = {
  block: { tag: 'STOP', word: 'Block', text: 'text-flag-red', fill: 'bg-flag-red/15', border: 'border-flag-red', edge: 'shadow-[inset_3px_0_0_var(--flag-red)]' },
  approve: { tag: 'PIT', word: 'Needs a lead', text: 'text-flag-blue', fill: 'bg-flag-blue/15', border: 'border-flag-blue', edge: 'shadow-[inset_3px_0_0_var(--flag-blue)]' },
} as const;

function Tag({ rule }: { rule: RuleWithStats }) {
  const flag = FLAG[rule.action];
  const ghost = rule.mode === 'shadow';
  return (
    <span
      className={cn(
        'broadcast w-11 shrink-0 rounded py-0.5 text-center text-[11px]',
        flag.text,
        ghost ? `border border-dashed ${flag.border} opacity-70` : flag.fill,
      )}
    >
      <span aria-hidden="true">{flag.tag}</span>
      <span className="sr-only">
        {flag.word}
        {ghost ? ', shadow' : ', live'}
      </span>
    </span>
  );
}

/** Seven small bars: how often the rule matched each day, oldest first. */
function Spark({ rule }: { rule: RuleWithStats }) {
  const max = Math.max(1, ...rule.matches);
  const total = rule.matches.reduce((a, b) => a + b, 0);
  return (
    <span className="hidden w-[92px] shrink-0 items-center gap-1.5 sm:flex" title="Last 7 days">
      <span aria-hidden="true" className="flex h-4 items-end gap-0.5">
        {rule.matches.map((count, i) => (
          <i
            key={i}
            className={cn('w-[5px] rounded-[1px]', count === 0 ? 'bg-white/10' : rule.mode === 'shadow' ? 'bg-muted-foreground' : rule.action === 'block' ? 'bg-flag-red' : 'bg-flag-blue')}
            style={{ height: 2 + (count / max) * 14 }}
          />
        ))}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {total}
        <span className="sr-only"> {rule.mode === 'shadow' ? 'would have matched' : 'matched'} in the last 7 days</span>
      </span>
    </span>
  );
}

function ModeSwitch({ rule, teamId }: { rule: RuleWithStats; teamId: string }) {
  const update = useUpdateRule(teamId);
  return (
    <div role="radiogroup" aria-label={`${rule.name} mode`} className="flex w-[112px] shrink-0 overflow-hidden rounded-md border border-white/12">
      {(['shadow', 'enforce'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={rule.mode === mode}
          onClick={() => rule.mode !== mode && update.mutate({ ruleId: rule.id, mode })}
          className={cn(
            'broadcast flex-1 py-1 text-[11px] text-muted-foreground transition-colors',
            rule.mode === mode && 'bg-white/12 text-foreground',
          )}
        >
          {mode === 'shadow' ? 'Shadow' : 'Live'}
        </button>
      ))}
    </div>
  );
}

function OnSwitch({ rule, teamId }: { rule: RuleWithStats; teamId: string }) {
  const update = useUpdateRule(teamId);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={rule.enabled}
      aria-label={`${rule.name} on`}
      onClick={() => update.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
      className={cn('relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors', rule.enabled ? 'bg-flag-green' : 'bg-white/15')}
    >
      <i className={cn('absolute top-0.5 size-3.5 rounded-full bg-white transition-[left]', rule.enabled ? 'left-[14px]' : 'left-0.5')} />
    </button>
  );
}

function RuleRow({
  rule,
  hit,
  canEdit,
  teamId,
  onEdit,
}: {
  rule: RuleWithStats;
  hit: boolean;
  canEdit: boolean;
  teamId: string;
  onEdit: () => void;
}) {
  const name = (
    <span className={cn('block truncate text-sm', rule.mode === 'shadow' && 'opacity-60', !rule.enabled && 'text-muted-foreground line-through')}>
      {rule.name}
      {!rule.enabled && <span className="sr-only"> (off)</span>}
    </span>
  );
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/5 px-3.5 py-3 transition-[background,box-shadow] first:border-t-0',
        hit && `bg-white/[0.05] ${FLAG[rule.action].edge}`,
      )}
    >
      <Tag rule={rule} />
      <span className="min-w-0 flex-1">
        {canEdit ? (
          <button type="button" onClick={onEdit} className="block w-full text-left hover:underline">
            {name}
          </button>
        ) : (
          name
        )}
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {rule.tool.replaceAll('|', ' · ')} {rule.pattern}
        </span>
      </span>
      {/* On phones the controls take a second line, so the name keeps its room. */}
      <span className={cn('flex items-center justify-end gap-3', canEdit && 'w-full sm:w-auto')}>
        <Spark rule={rule} />
        {canEdit ? (
          <>
            <ModeSwitch rule={rule} teamId={teamId} />
            <OnSwitch rule={rule} teamId={teamId} />
          </>
        ) : (
          <span className="broadcast w-12 shrink-0 text-right text-[11px] text-muted-foreground">{rule.mode === 'shadow' ? 'Shadow' : 'Live'}</span>
        )}
      </span>
    </li>
  );
}

function Verdict({ result, rules }: { result: RuleTestResult | undefined; rules: RuleWithStats[] }) {
  if (!result) return null;
  const name = (id: string | null) => rules.find((r) => r.id === id)?.name ?? 'a rule';
  const shadow = result.shadowIds.map(name);
  return (
    <>
      {result.decision === 'deny' && (
        <>
          <span className="text-flag-red">● Stopped</span> by {name(result.ruleId)}
        </>
      )}
      {result.decision === 'ask' && (
        <>
          <span className="text-flag-blue">● Pit lane</span>: {name(result.ruleId)} needs a lead
        </>
      )}
      {result.decision === 'none' && 'Goes through'}
      {shadow.length > 0 && <span> · Shadow: {shadow.join(', ')}</span>}
    </>
  );
}

type Draft = { id?: string; name: string; action: RuleAction; chips: ChipKey[]; extra: string[]; pattern: string };

const EMPTY_DRAFT: Draft = { name: '', action: 'block', chips: ['Edit', 'Write'], extra: [], pattern: '' };

function draftError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'too_many_rules') return 'Your team has the most rules allowed. Turn one off or edit it instead.';
  if (error instanceof ApiError && error.status === 400) return 'Check the name and pattern.';
  return "That didn't save. Try again.";
}

function Drawer({ draft: initial, teamId, onClose }: { draft: Draft; teamId: string; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const create = useCreateRule(teamId);
  const update = useUpdateRule(teamId);
  const tool = chipsToTool(draft.chips, draft.extra);
  const preview = useRulePreview(teamId, tool, draft.pattern);
  const saving = create.isPending || update.isPending;
  const missing = !draft.name.trim() ? 'Name the rule' : !draft.pattern.trim() ? 'Add a pattern' : !tool ? 'Pick a tool' : null;

  const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));
  const toggleChip = (key: ChipKey) =>
    set({ chips: draft.chips.includes(key) ? draft.chips.filter((c) => c !== key) : [...draft.chips.filter((c) => key !== '*' && c !== '*'), key] });

  const save = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (missing) return;
    const rule = { name: draft.name.trim(), tool, pattern: draft.pattern.trim(), action: draft.action };
    if (draft.id) update.mutate({ ruleId: draft.id, ...rule }, { onSuccess: onClose });
    else create.mutate(rule, { onSuccess: onClose });
  };

  return (
    <form onSubmit={save} aria-label={draft.id ? 'Edit rule' : 'New rule'} className="glass overflow-hidden rounded-xl">
      <div aria-hidden="true" className="kerb h-[3px]" />
      <div className="grid gap-3 p-4">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Name it"
            aria-label="Rule name"
            maxLength={100}
            className="min-w-0 flex-1 border-b border-white/12 bg-transparent py-1 text-base font-medium outline-none placeholder:text-muted-foreground/60 focus:border-ring"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div role="radiogroup" aria-label="What it does" className="flex w-[170px] overflow-hidden rounded-md border border-white/12">
            {(['block', 'approve'] as const).map((action) => (
              <button
                key={action}
                type="button"
                role="radio"
                aria-checked={draft.action === action}
                onClick={() => set({ action })}
                className={cn('broadcast flex-1 py-1.5 text-[11px] text-muted-foreground', draft.action === action && `bg-white/12 ${FLAG[action].text}`)}
              >
                <span aria-hidden="true">{action === 'block' ? 'Stop' : 'Pit'}</span>
                <span className="sr-only">{FLAG[action].word}</span>
              </button>
            ))}
          </div>
          <div role="group" aria-label="Tools" className="flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => (
              <button
                key={chip.key}
                type="button"
                aria-pressed={draft.chips.includes(chip.key)}
                onClick={() => toggleChip(chip.key)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs',
                  draft.chips.includes(chip.key) ? 'border-foreground text-foreground' : 'border-white/12 text-muted-foreground',
                )}
              >
                {chip.label}
              </button>
            ))}
            {draft.extra.map((name) => (
              <span key={name} className="rounded-full border border-foreground px-2.5 py-1 font-mono text-xs">
                {name}
              </span>
            ))}
          </div>
        </div>
        <input
          value={draft.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
          placeholder={draft.chips.includes('Bash') && draft.chips.length === 1 ? 'npm publish*' : '**/migrations/**'}
          aria-label="Pattern"
          maxLength={300}
          spellCheck={false}
          className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-2 font-mono text-[13px] outline-none placeholder:text-muted-foreground/50 focus:border-ring"
        />
        <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
          {preview.data &&
            (preview.data.count === 0 ? (
              'Nothing in the last 7 days'
            ) : (
              <>
                Would have caught <span className="font-medium text-foreground">{preview.data.count}</span> in the last 7 days:{' '}
                <span className="font-mono">{preview.data.examples.join(', ')}</span>
              </>
            ))}
        </p>
        {touched && missing && <p className="text-xs text-flag-red">{missing}</p>}
        {(create.error ?? update.error) && <p className="text-xs text-flag-red">{draftError(create.error ?? update.error)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={quietButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={cn(primaryButton, 'h-10 w-auto px-4 text-sm')}>
            {draft.id ? 'Save' : 'Add in shadow'}
          </button>
        </div>
      </div>
    </form>
  );
}

export function RulesPage() {
  const { me, team } = useTeamContext();
  const rules = useRules(team.id);
  const starter = useAddStarterRules(team.id);
  const [lane, setLane] = useState('');
  const test = useRuleTest(team.id, lane, rules.dataUpdatedAt);
  const [draft, setDraft] = useState<Draft>();
  const canEdit = team.role === 'lead';
  const list = rules.data ?? [];
  const live = list.filter((r) => r.enabled && r.mode === 'enforce').length;
  const shadow = list.filter((r) => r.enabled && r.mode === 'shadow').length;
  const result = lane.trim() ? test.data : undefined;
  const isHit = (rule: RuleWithStats) => !!result && (result.ruleId === rule.id || result.shadowIds.includes(rule.id));

  const edit = (rule: RuleWithStats) => setDraft({ id: rule.id, name: rule.name, action: rule.action, pattern: rule.pattern, ...toolsToChips(rule.tool) });

  return (
    <AppShell team={team} teams={me.teams} active="rules" userEmail={me.user.email}>
      <div className="mx-auto max-w-3xl space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3.5">
            <h1 className="broadcast text-2xl">Rules</h1>
            {list.length > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="text-flag-red">●</span> {live} live · ◌ {shadow} shadow
              </span>
            )}
          </div>
          {canEdit && list.length > 0 && !draft && (
            <button type="button" onClick={() => setDraft(EMPTY_DRAFT)} className={cn(primaryButton, 'flex h-9 w-auto items-center gap-1.5 px-3 text-sm')}>
              <Plus className="size-4" aria-hidden="true" /> New rule
            </button>
          )}
        </div>

        {draft && <Drawer key={draft.id ?? 'new'} draft={draft} teamId={team.id} onClose={() => setDraft(undefined)} />}

        {rules.isPending && (
          <div role="status" className="glass h-48 animate-pulse rounded-xl">
            <span className="sr-only">Loading rules</span>
          </div>
        )}
        {rules.isError && (
          <div role="alert" className="glass space-y-2 rounded-xl p-6">
            <p className="font-medium">Couldn't load the rules.</p>
            <button type="button" onClick={() => void rules.refetch()} className={quietButton}>
              Try again
            </button>
          </div>
        )}

        {rules.isSuccess && list.length === 0 && (
          <div className="glass space-y-3 rounded-xl p-6 text-center">
            <p className="broadcast text-xl">No rules yet</p>
            <p className="text-sm text-muted-foreground">
              {canEdit
                ? "Start with five common ones, in shadow mode: they record what they'd catch and stop no one."
                : 'A lead can add rules here. Until then, nothing is blocked.'}
            </p>
            {canEdit && (
              <button type="button" disabled={starter.isPending} onClick={() => starter.mutate()} className={cn(primaryButton, 'mx-auto h-10 w-auto px-4 text-sm')}>
                Add the starter rules
              </button>
            )}
          </div>
        )}

        {list.length > 0 && (
          <>
            <div className="glass relative rounded-xl">
              <FlagTriangleRight aria-hidden="true" className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <input
                value={lane}
                onChange={(e) => setLane(e.target.value)}
                placeholder="Try a file or a command: apps/api/.env"
                aria-label="Try a file path or command"
                spellCheck={false}
                className="w-full bg-transparent py-2.5 pr-3 pl-9 font-mono text-[13px] outline-none placeholder:text-muted-foreground/60"
              />
              {result && (
                <p aria-live="polite" className="px-9 pb-2.5 text-xs text-muted-foreground">
                  <Verdict result={result} rules={list} />
                </p>
              )}
            </div>
            <ul aria-label="Rules" className="glass overflow-hidden rounded-xl">
              {list.map((rule) => (
                <RuleRow key={rule.id} rule={rule} hit={isHit(rule)} canEdit={canEdit} teamId={team.id} onEdit={() => edit(rule)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
