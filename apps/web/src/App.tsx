import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { LightsOut } from '@/components/lights-out';
import { LiveClock } from '@/components/live-clock';
import { RaceControlBanner } from '@/components/race-control-banner';
import type { FlagStatus } from '@/components/status-flag';
import { TeamRadioCard } from '@/components/team-radio-card';
import { TimingTower, type Driver } from '@/components/timing-tower';

// Sample data for the design preview. Sign-in and real teams replace this in steps 7b to 7d,
// and live agents arrive with the hook endpoints in Week 2.
const SAMPLE_DRIVERS: Driver[] = [
  { id: '1', code: 'NIM', name: 'Nimal', agent: 'claude_code', status: 'yellow', laps: 44, sectors: ['clean', 'tests', 'yellow'] },
  { id: '2', code: 'KAS', name: 'Kasun', agent: 'claude_code', status: 'yellow', laps: 42, sectors: ['clean', 'clean', 'yellow'] },
  { id: '3', code: 'AMA', name: 'Amaya', agent: 'codex', status: 'waiting', laps: 37, sectors: ['tests', 'clean', 'clean'] },
  { id: '4', code: 'RUW', name: 'Ruwan', agent: 'claude_code', status: 'working', laps: 36, sectors: ['clean', 'tests', 'clean'] },
  { id: '5', code: 'JAN', name: 'Janith', agent: 'claude_code', status: 'blocked', laps: 30, sectors: ['clean', 'clean', 'blocked'] },
];
const SESSION_START = new Date(Date.now() - (2 * 3600 + 14 * 60) * 1000);

function countByStatus(drivers: Driver[]) {
  const counts: Partial<Record<FlagStatus, number>> = {};
  for (const d of drivers) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return counts;
}

export function App() {
  const [selectedId, setSelectedId] = useState<string>();

  return (
    <>
      <LightsOut />
      <AppShell
        teamName="BuildFlow"
        basePath=""
        active="pit-wall"
        counts={countByStatus(SAMPLE_DRIVERS)}
        actions={<LiveClock since={SESSION_START} className="hidden sm:inline-flex" />}
      >
        <h1 className="sr-only">Pit wall</h1>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <TimingTower
            drivers={SAMPLE_DRIVERS}
            selectedId={selectedId}
            onSelect={(d) => setSelectedId((id) => (id === d.id ? undefined : d.id))}
            className="w-full shrink-0 md:w-[268px]"
          />
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <RaceControlBanner status="yellow" message="Auth · NIM & KAS" detail="auth/session.ts" />
            <RaceControlBanner status="blocked" message="JAN · rule: never touch .env" detail="edit hooks/.env" />
          </div>
        </div>
        <TeamRadioCard
          from="NIM"
          to="KAS"
          quote="Kasun, I'm in session.ts. Hold your edit."
          className="fixed inset-x-3 bottom-20 z-20 mx-auto max-w-[360px] md:bottom-6"
        />
      </AppShell>
    </>
  );
}
