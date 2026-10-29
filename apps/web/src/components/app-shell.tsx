import { Gauge, Settings2, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FLAGS, type FlagStatus } from '@/components/status-flag';
import { AccountMenu } from '@/components/theme-menu';
import { TrackScene } from '@/components/track-scene';
import { Wordmark } from '@/components/wordmark';
import { cn } from '@/lib/utils';

export type NavKey = 'pit-wall' | 'team' | 'settings';

// Sessions, Approvals and Rules join this list in the weeks they're built (docs/design/UI.md).
const navItems: Array<{ key: NavKey; label: string; icon: LucideIcon; path: string }> = [
  { key: 'pit-wall', label: 'Pit wall', icon: Gauge, path: '' },
  { key: 'team', label: 'Team', icon: Users, path: '/team' },
  { key: 'settings', label: 'Settings', icon: Settings2, path: '/settings' },
];

const COUNTED: FlagStatus[] = ['working', 'yellow', 'waiting', 'blocked'];

type AppShellProps = {
  teamName: string;
  /** Base path of the current team, e.g. `/t/123`. */
  basePath: string;
  active: NavKey;
  /** How many agents have each status, for the counters in the top bar. */
  counts?: Partial<Record<FlagStatus, number>>;
  /** Extra items on the right of the top bar, e.g. the live clock. */
  actions?: ReactNode;
  /** The signed-in person's email, for the account menu. */
  userEmail: string;
  children: ReactNode;
};

/** Floating glass chrome over the track scene: icon rail and top bar on desktop, top bar and tab bar on phones. */
export function AppShell({ teamName, basePath, active, counts, actions, userEmail, children }: AppShellProps) {
  const href = (path: string) => basePath + path || '/';

  return (
    <div className="relative min-h-dvh">
      <TrackScene />

      <nav aria-label="Main" className="glass fixed top-4 bottom-4 left-4 z-20 hidden w-[52px] flex-col items-center gap-1.5 rounded-2xl py-2.5 md:flex">
        {navItems.map(({ key, label, icon: Icon, path }) => (
          <a
            key={key}
            href={href(path)}
            aria-label={label}
            aria-current={key === active ? 'page' : undefined}
            className={cn(
              'group relative grid size-9 place-items-center rounded-[10px] text-muted-foreground/70 hover:bg-white/5 hover:text-foreground',
              key === active && 'bg-white/[0.08] text-foreground',
              key === 'settings' && 'mt-auto',
            )}
          >
            <Icon className="size-[18px]" aria-hidden="true" />
            <span className="glass pointer-events-none absolute left-12 rounded-lg px-2 py-1 text-xs whitespace-nowrap text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {label}
            </span>
          </a>
        ))}
      </nav>

      <header className="fixed inset-x-4 top-4 z-20 flex items-center justify-between gap-3 md:left-[84px]">
        <div className="glass flex min-w-0 items-center gap-3 rounded-xl py-1.5 pr-3 pl-2">
          <Wordmark />
          <span className="hidden truncate rounded-md border border-glass-line px-2 py-0.5 text-xs text-muted-foreground sm:inline">
            {teamName}
          </span>
        </div>

        {counts && (
          <div aria-label="Agents by status" className="glass hidden items-center gap-3.5 rounded-full px-3.5 py-2 lg:flex">
            {COUNTED.map((status) => (
              <span key={status} className="flex items-center gap-1.5 text-[13px]" style={{ color: FLAGS[status].color }}>
                <span aria-hidden="true" className="size-[7px] rounded-full bg-current shadow-[0_0_10px_currentColor]" />
                <span className="font-medium text-foreground tabular-nums">{counts[status] ?? 0}</span>
                <span className="sr-only">{FLAGS[status].label}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {actions}
          <AccountMenu email={userEmail} />
        </div>
      </header>

      <main className="relative z-10 px-4 pt-20 pb-24 md:pt-[72px] md:pr-4 md:pb-6 md:pl-[84px]">{children}</main>

      <nav
        aria-label="Main"
        className="glass fixed inset-x-3 bottom-3 z-20 grid grid-cols-3 rounded-2xl pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {navItems.map(({ key, label, icon: Icon, path }) => (
          <a
            key={key}
            href={href(path)}
            aria-label={label}
            aria-current={key === active ? 'page' : undefined}
            className={cn(
              'flex min-h-14 items-center justify-center text-muted-foreground',
              key === active && 'text-foreground',
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </a>
        ))}
      </nav>
    </div>
  );
}
