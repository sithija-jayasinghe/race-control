import { createDevTokenRequestSchema, type DevToken } from '@race-control/shared';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { CopyButton } from '@/components/copy-button';
import { Panel } from '@/components/panel';
import { ApiError } from '@/lib/api';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { useCreateToken, useRevokeToken, useTokens } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { inputClass, primaryButton, quietButton } from '@/pages/sign-in';
import { useTeamContext } from '@/routes';

function createError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'too_many_tokens') {
    return 'You have 10 active tokens in this team. Revoke one you no longer use first.';
  }
  return "Couldn't create a token. Try again.";
}

function TokenRow({ token, showOwner, teamId }: { token: DevToken; showOwner: boolean; teamId: string }) {
  const revoke = useRevokeToken(teamId);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="border-t border-white/5 px-4 py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{token.label}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {showOwner && `${token.userEmail} · `}created {timeAgo(token.createdAt)} ·{' '}
            {token.lastUsedAt ? `last used ${timeAgo(token.lastUsedAt)}` : 'never used'}
          </span>
        </span>
        {!confirming && (
          <button
            type="button"
            aria-label={`Revoke ${token.label}`}
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-white/5 hover:text-flag-red"
            onClick={() => setConfirming(true)}
          >
            Revoke
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
          <span className="mr-auto text-muted-foreground">Revoke it? Agents using it stop reporting straight away.</span>
          <button type="button" className={quietButton} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="h-10 rounded-xl bg-flag-red px-3 font-medium text-white disabled:opacity-50"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(token.id, { onSettled: () => setConfirming(false) })}
          >
            Revoke
          </button>
        </div>
      )}
    </li>
  );
}

function TokensPanel({ teamId, myUserId, isLead }: { teamId: string; myUserId: string; isLead: boolean }) {
  const tokens = useTokens(teamId);
  const create = useCreateToken(teamId);
  const [label, setLabel] = useState('');
  const [inputError, setInputError] = useState<string>();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = createDevTokenRequestSchema.safeParse({ label });
    if (!parsed.success) {
      setInputError('Name the token after where it runs, e.g. "Work laptop".');
      return;
    }
    create.mutate(parsed.data.label, { onSuccess: () => setLabel('') });
  };

  const exportLine = create.data ? `export RACE_CONTROL_TOKEN=${create.data.token}` : '';

  return (
    <Panel title={isLead ? 'Agent tokens' : 'Your agent tokens'}>
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Your agents send their activity with a token. Make one per machine, so you can revoke a single laptop.
        </p>
        <form noValidate onSubmit={onSubmit} className="space-y-2">
          <div className="flex gap-2">
            <input
              aria-label="Token name"
              placeholder="Work laptop"
              maxLength={60}
              value={label}
              aria-invalid={inputError ? true : undefined}
              onChange={(e) => {
                setLabel(e.target.value);
                setInputError(undefined);
              }}
              className={cn(inputClass, 'h-10')}
            />
            <button type="submit" className={cn(primaryButton, 'h-10 w-auto shrink-0 px-4')} disabled={create.isPending}>
              Create token
            </button>
          </div>
          {inputError && <p className="text-sm text-flag-red">{inputError}</p>}
          {create.isError && (
            <p role="alert" className="text-sm text-flag-red">
              {createError(create.error)}
            </p>
          )}
        </form>

        {create.data && (
          <div className="space-y-3 rounded-xl border border-flag-green/30 bg-flag-green/5 p-3">
            <p className="text-sm">
              <span className="font-medium">{create.data.label}</span> is ready. Copy it now: it won't be shown again.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label="New token"
                value={create.data.token}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-lg bg-black/30 px-2.5 font-mono text-xs outline-none"
              />
              <CopyButton text={create.data.token} label="token" />
            </div>
            <p className="text-xs text-muted-foreground">Then add it to your shell profile (for example ~/.zshrc):</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-2.5 py-2 font-mono text-xs">
                export RACE_CONTROL_TOKEN=rc_…
              </code>
              <CopyButton text={exportLine} label="export line" />
            </div>
          </div>
        )}

        {tokens.isPending && <div className="h-12 animate-pulse rounded-lg bg-white/5" />}
        {tokens.isError && (
          <p role="alert" className="text-sm text-flag-red">
            Couldn't load tokens.
          </p>
        )}
      </div>
      {tokens.data && tokens.data.length > 0 && (
        <ul aria-label="Active tokens" className="border-t border-white/5">
          {tokens.data.map((token) => (
            <TokenRow key={token.id} token={token} showOwner={token.userId !== myUserId} teamId={teamId} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const themes: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
];

function AppearancePanel() {
  const { choice, setChoice } = useTheme();
  return (
    <Panel title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 p-4">
        {themes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            onClick={() => setChoice(value)}
            className={cn(
              'flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-glass-line text-sm text-muted-foreground hover:bg-white/5',
              choice === value && 'border-foreground/40 bg-white/[0.07] text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function SettingsPage() {
  const { me, team } = useTeamContext();
  return (
    <AppShell team={team} teams={me.teams} active="settings" userEmail={me.user.email}>
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="broadcast text-2xl">Settings</h1>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px] md:items-start">
          <TokensPanel teamId={team.id} myUserId={me.user.id} isLead={team.role === 'lead'} />
          <AppearancePanel />
        </div>
      </div>
    </AppShell>
  );
}
