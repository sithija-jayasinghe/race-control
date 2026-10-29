import { FLAGS, type FlagStatus } from '@/components/status-flag';
import { cn } from '@/lib/utils';

/** What one recent action was, coloured like F1 sector times. */
export type Sector = 'clean' | 'tests' | 'yellow' | 'blocked';

const SECTOR_COLORS: Record<Sector, string> = {
  clean: 'var(--flag-green)',
  tests: 'var(--sector-purple)',
  yellow: 'var(--flag-yellow)',
  blocked: 'var(--flag-red)',
};

export type Driver = {
  id: string;
  /** Three-letter code, e.g. NIM. */
  code: string;
  name: string;
  agent: 'claude_code' | 'codex';
  status: FlagStatus;
  /** Completed tool calls this session. */
  laps: number;
  /** The last three actions, oldest first. */
  sectors: Sector[];
};

const AGENT_SHORT = { claude_code: 'CC', codex: 'CDX' } as const;
const AGENT_NAME = { claude_code: 'Claude Code', codex: 'Codex' } as const;

/** Drivers in race order: most laps first. */
export function raceOrder(drivers: Driver[]): Driver[] {
  return [...drivers].sort((a, b) => b.laps - a.laps || a.code.localeCompare(b.code));
}

/** The gap column: LEAD, PIT and STOP as words, otherwise laps behind the leader. */
export function gapLabel(driver: Driver, leaderLaps: number, position: number): string {
  if (driver.status === 'waiting') return 'PIT';
  if (driver.status === 'blocked') return 'STOP';
  if (position === 1) return 'LEAD';
  return `+${leaderLaps - driver.laps}`;
}

/** The F1 TV-style leaderboard of a team's agents. */
export function TimingTower({
  drivers,
  selectedId,
  onSelect,
  className,
}: {
  drivers: Driver[];
  selectedId?: string;
  onSelect?: (driver: Driver) => void;
  className?: string;
}) {
  const order = raceOrder(drivers);
  const leaderLaps = order[0]?.laps ?? 0;

  return (
    <section aria-label="Timing tower" className={cn('glass overflow-hidden rounded-xl', className)}>
      <header className="flex items-center justify-between bg-black/30 px-3 py-2.5">
        <h2 className="broadcast text-[13px]">Pit wall</h2>
        <span className="font-mono text-[11px] text-muted-foreground">LAP {leaderLaps}</span>
      </header>
      <div className="kerb" aria-hidden="true" />
      <ol>
        {order.map((driver, index) => {
          const position = index + 1;
          const gap = gapLabel(driver, leaderLaps, position);
          return (
            <li key={driver.id} className="border-t border-white/5 first:border-t-0">
              <button
                type="button"
                onClick={() => onSelect?.(driver)}
                aria-pressed={driver.id === selectedId}
                aria-label={`P${position}, ${driver.name}, ${AGENT_NAME[driver.agent]}, ${FLAGS[driver.status].label}, ${driver.laps} laps`}
                className={cn(
                  'grid h-[38px] w-full grid-cols-[22px_4px_1fr_auto_40px] items-center gap-2.5 pr-3 pl-2.5 text-left transition-colors hover:bg-white/5',
                  driver.id === selectedId && 'bg-white/[0.07]',
                )}
              >
                <span className="broadcast text-center text-[15px] tracking-normal">{position}</span>
                <span
                  aria-hidden="true"
                  className="h-5 w-1 rounded-full"
                  style={{ background: FLAGS[driver.status].color, boxShadow: `0 0 10px ${FLAGS[driver.status].color}` }}
                />
                <span className="font-display text-[15px] font-bold tracking-[0.05em]">
                  {driver.code}
                  <small className="ml-1.5 font-mono text-[10px] font-normal tracking-normal text-muted-foreground/70">
                    {AGENT_SHORT[driver.agent]}
                  </small>
                </span>
                <span aria-hidden="true" className="flex gap-0.5">
                  {[0, 1, 2].map((i) => {
                    const sector = driver.sectors[i];
                    return (
                      <i
                        key={i}
                        className="h-1 w-2.5 rounded-[1px] bg-white/10"
                        style={sector ? { background: SECTOR_COLORS[sector] } : undefined}
                      />
                    );
                  })}
                </span>
                <span className="text-right font-mono text-xs text-muted-foreground">{gap}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
