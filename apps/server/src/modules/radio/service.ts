import type { TeamRadio } from '@race-control/shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events } from '../../db/schema.ts';
import { recentEdits, toDriver } from '../flags/repo.ts';

type Driver = TeamRadio['about'][number];

const MAX_NAME = 40;
const MAX_PATH = 200;

/**
 * A person's name, safe to put in front of an agent. Names are typed by people, so anything that could
 * read as markup or an instruction is dropped: only letters, digits, spaces and . ' - _ are kept.
 */
export function radioName(person: Pick<Driver, 'userName' | 'userEmail'>): string {
  const raw = person.userName?.trim() || person.userEmail.split('@')[0] || '';
  const name = raw
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N} .'_-]/gu, '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  return name || 'A teammate';
}

/** A file path, safe to quote in backticks: no control characters, markup or backticks, and not too long. */
export function radioPath(path: string): string {
  const clean = path.replace(/[\p{Cc}<>`]/gu, '').trim();
  return clean.length > MAX_PATH ? `…${clean.slice(-(MAX_PATH - 1))}` : clean;
}

function ago(fromIso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(fromIso)) / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
}

/**
 * The heads-up an agent reads, built only from stored metadata (who, which file, when). Factual on
 * purpose: Claude Code's docs advise against wording context as commands.
 */
export function radioMessage(about: Driver[], target: string, now: Date): string {
  const file = `\`${radioPath(target)}\``;
  const latest = ago(about[0]!.lastAt, now);
  let who: string;
  if (about.length === 1) {
    const agent = about[0]!.agent === 'codex' ? 'Codex' : 'Claude Code';
    who = `${radioName(about[0]!)}'s ${agent} agent edited ${file} ${latest} in another session.`;
  } else {
    const names = about.slice(0, 2).map((d) => `${radioName(d)}'s`);
    const others = about.length - 2;
    const list = others > 0 ? `${names.join(', ')} and ${others} ${others === 1 ? "other person's" : "other people's"}` : names.join(' and ');
    who = `${list} agents edited ${file} in other sessions, most recently ${latest}.`;
  }
  return `Race Control (team note): ${who} Those changes may not be in your copy yet.`;
}

/**
 * The people a session should hear about before working on a file: others on the team whose agents edited
 * it in the same repo within the flag window, latest first. Each session hears about a file once, so
 * this returns nothing if an earlier call in the session already carried a heads-up for it.
 */
export async function findTeamRadio(
  db: DbOrTx,
  call: { teamId: string; userId: string; sessionId: string; repoName: string; target: string; now: Date },
): Promise<Driver[]> {
  const [heard] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.teamId, call.teamId),
        eq(events.sessionId, call.sessionId),
        eq(events.target, call.target),
        isNotNull(sql`${events.payloadRedacted} -> 'radio'`),
      ),
    )
    .limit(1);
  if (heard) return [];

  const latest = new Map<string, Driver>();
  for (const edit of await recentEdits(db, call.teamId, call.now, { repoName: call.repoName, target: call.target })) {
    // Your own agents never get a heads-up about each other.
    if (edit.userId === call.userId) continue;
    const seen = latest.get(edit.userId);
    if (!seen || edit.createdAt.toISOString() > seen.lastAt) latest.set(edit.userId, toDriver(edit));
  }
  return [...latest.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
