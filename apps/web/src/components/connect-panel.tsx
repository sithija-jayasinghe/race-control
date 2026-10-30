import { TOKEN_ENV_VAR, buildHookSettings } from '@race-control/shared';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Panel } from '@/components/panel';
import { useHookSetup, useSessions } from '@/lib/sessions';
import { timeAgo } from '@/lib/time';
import { useTokens } from '@/lib/tokens';
import { cn } from '@/lib/utils';

const LOCATIONS = {
  project: {
    label: 'This project',
    file: '.claude/settings.json',
    note: 'In the project folder. Commit it and everyone on the team gets the hooks; each person uses their own token.',
  },
  user: {
    label: 'All my projects',
    file: '~/.claude/settings.json',
    note: 'In your home folder. Every project you open sends activity, under your token.',
  },
} as const;

function Step({ number, done, title, children }: { number: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'broadcast grid size-7 shrink-0 place-items-center rounded-full border border-glass-line text-xs tracking-normal',
          done && 'border-flag-green bg-flag-green/15 text-flag-green',
        )}
      >
        {done ? <Check className="size-3.5" aria-label="Done" /> : number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** How to connect Claude Code: token in the shell, hooks in settings.json, then start a session. */
export function ConnectPanel({ teamId, myUserId }: { teamId: string; myUserId: string }) {
  const setup = useHookSetup();
  const tokens = useTokens(teamId);
  const sessions = useSessions(teamId);
  const [location, setLocation] = useState<keyof typeof LOCATIONS>('project');

  const hasToken = (tokens.data ?? []).some((t) => t.userId === myUserId);
  const mySession = (sessions.data ?? []).find((s) => s.userId === myUserId);
  const snippet = setup.data ? JSON.stringify(buildHookSettings(setup.data.hooksUrl), null, 2) : '';
  const where = LOCATIONS[location];

  return (
    <Panel title="Connect Claude Code">
      <ol id="connect" className="scroll-mt-24 space-y-5 p-4">
        <Step number={1} done={hasToken} title="Put your token in your shell">
          <p className="text-sm text-muted-foreground">
            Create a token above, add its <code className="font-mono text-xs">export {TOKEN_ENV_VAR}=…</code> line to
            your shell profile, then open a new terminal.
          </p>
        </Step>

        <Step number={2} done={Boolean(mySession)} title="Add Race Control's hooks">
          <div role="radiogroup" aria-label="Where to add the hooks" className="flex w-fit rounded-xl border border-glass-line p-1">
            {(Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={location === key}
                onClick={() => setLocation(key)}
                className={cn('h-8 rounded-lg px-3 text-sm text-muted-foreground', location === key && 'bg-white/10 text-foreground')}
              >
                {LOCATIONS[key].label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Add this to <code className="font-mono text-xs text-foreground">{where.file}</code>. {where.note} If the file
            already has settings, add the <code className="font-mono text-xs">hooks</code> part to it.
          </p>
          {setup.isError && (
            <p role="alert" className="text-sm text-flag-red">
              Couldn't load the settings. Reload the page to try again.
            </p>
          )}
          {snippet && (
            <div className="relative">
              <pre
                aria-label="Hook settings"
                className="max-h-64 overflow-auto rounded-xl bg-black/40 p-3 pr-24 font-mono text-[11px] leading-relaxed"
              >
                {snippet}
              </pre>
              <div className="absolute top-2 right-2">
                <CopyButton text={snippet} label="hook settings" />
              </div>
            </div>
          )}
        </Step>

        <Step number={3} done={Boolean(mySession)} title="Start Claude Code in that project">
          <p className="text-sm text-muted-foreground">
            {mySession
              ? `Connected. Your last activity arrived ${timeAgo(mySession.lastEventAt)}.`
              : "You'll appear on the Pit wall within seconds of your first action."}
          </p>
        </Step>
      </ol>
    </Panel>
  );
}
