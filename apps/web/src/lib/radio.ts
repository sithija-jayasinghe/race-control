import type { TeamRadio } from '@race-control/shared';
import { useQuery } from '@tanstack/react-query';

export const radioKey = (teamId: string) => ['teams', teamId, 'radio'] as const;

/** How long the Pit wall shows a heads-up. */
export const RADIO_SHOW_MS = 15_000;
const MAX_RADIO = 20;

/** Heads-ups heard on the live channel since the page opened, newest first. Only the live channel fills it. */
export function useTeamRadio(teamId: string): TeamRadio[] {
  return useQuery<TeamRadio[]>({ queryKey: radioKey(teamId), queryFn: () => [], enabled: false, staleTime: Infinity }).data ?? [];
}

export function addRadio(list: TeamRadio[], radio: TeamRadio): TeamRadio[] {
  return [radio, ...list.filter((r) => r.eventId !== radio.eventId)].slice(0, MAX_RADIO);
}

/** "Nimal", "Nimal & Kasun", "Nimal +2". */
export function radioNames(names: string[]): string {
  if (names.length <= 2) return names.join(' & ');
  return `${names[0]} +${names.length - 1}`;
}

/** What the agent was told, in a few words: "Nimal edited src/auth/session.ts 2 min ago". */
export function radioQuote(radio: TeamRadio): string {
  const who = radioNames(radio.about.map((d) => d.userName ?? d.userEmail.split('@')[0]!));
  const minutes = Math.floor((Date.parse(radio.createdAt) - Date.parse(radio.about[0]!.lastAt)) / 60_000);
  return `${who} edited ${radio.target} ${minutes < 1 ? 'just now' : `${minutes} min ago`}`;
}
