import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { PG, createTestDb, expectPgError, seedTeam, type TestDb } from '../helpers/db.ts';

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe('migration', () => {
  it('creates every table from the data model', async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'approvals',
      'dev_tokens',
      'events',
      'memberships',
      'rules',
      'sessions',
      'teams',
      'users',
    ]);
  });

  it('creates the event indexes from the spec', async () => {
    const result = await db.execute<{ indexname: string }>(sql`
      select indexname from pg_indexes where tablename = 'events'
    `);
    const names = result.rows.map((row) => row.indexname);

    expect(names).toEqual(
      expect.arrayContaining([
        'events_team_created_idx',
        'events_session_created_idx',
        'events_team_target_created_idx',
      ]),
    );
  });
});

describe('defaults', () => {
  it('starts sessions active, events undecided and rules in shadow mode', async () => {
    const { session, event, rule } = await seedTeam(db, 'Alpha');

    expect(session.status).toBe('active');
    expect(event.decision).toBe('none');
    expect(event.payloadRedacted).toEqual({});
    expect(rule.mode).toBe('shadow');
    expect(rule.enabled).toBe(true);
  });
});

describe('uniqueness', () => {
  it('treats emails case-insensitively', async () => {
    await db.insert(schema.users).values({ email: 'dev@example.test' });

    await expectPgError(db.insert(schema.users).values({ email: 'DEV@Example.test' }), PG.uniqueViolation);
  });

  it('allows one agent session id per team and agent', async () => {
    const alpha = await seedTeam(db, 'Alpha');
    const beta = await seedTeam(db, 'Beta');
    const duplicate = { agent: 'claude_code' as const, agentSessionId: alpha.session.agentSessionId };

    await expectPgError(
      db.insert(schema.sessions).values({ teamId: alpha.team.id, userId: alpha.user.id, ...duplicate }),
      PG.uniqueViolation,
    );
    // The same id from another agent, or in another team, is a different session.
    await db
      .insert(schema.sessions)
      .values({ teamId: alpha.team.id, userId: alpha.user.id, ...duplicate, agent: 'codex' });
    await db.insert(schema.sessions).values({ teamId: beta.team.id, userId: beta.user.id, ...duplicate });
  });

  it('allows at most one approval per event', async () => {
    const { team, session, event, rule } = await seedTeam(db, 'Alpha');
    const approval = { teamId: team.id, sessionId: session.id, eventId: event.id, ruleId: rule.id };
    await db.insert(schema.approvals).values(approval);

    await expectPgError(db.insert(schema.approvals).values(approval), PG.uniqueViolation);
  });

  it('rejects values outside the enums', async () => {
    const { team, user } = await seedTeam(db, 'Alpha');

    await expectPgError(
      db.execute(sql`insert into memberships (team_id, user_id, role) values (${team.id}, ${user.id}, 'admin')`),
      PG.invalidTextRepresentation,
    );
  });
});

describe('team isolation', () => {
  it("rejects an event that points at another team's session", async () => {
    const alpha = await seedTeam(db, 'Alpha');
    const beta = await seedTeam(db, 'Beta');

    await expectPgError(
      db.insert(schema.events).values({ teamId: beta.team.id, sessionId: alpha.session.id, type: 'PreToolUse' }),
      PG.foreignKeyViolation,
    );
  });

  it("rejects an approval that mixes in another team's session, event or rule", async () => {
    const alpha = await seedTeam(db, 'Alpha');
    const beta = await seedTeam(db, 'Beta');
    const own = { teamId: alpha.team.id, sessionId: alpha.session.id, eventId: alpha.event.id, ruleId: alpha.rule.id };

    for (const foreign of [
      { sessionId: beta.session.id },
      { eventId: beta.event.id },
      { ruleId: beta.rule.id },
    ]) {
      await expectPgError(db.insert(schema.approvals).values({ ...own, ...foreign }), PG.foreignKeyViolation);
    }
  });

  it('only issues dev tokens to members of the team', async () => {
    const alpha = await seedTeam(db, 'Alpha');
    const beta = await seedTeam(db, 'Beta');

    await expectPgError(
      db.insert(schema.devTokens).values({
        teamId: beta.team.id,
        userId: alpha.user.id,
        tokenHash: 'hash-1',
        label: 'laptop',
      }),
      PG.foreignKeyViolation,
    );
  });

  it("deleting a team removes all of its data and none of another team's", async () => {
    const alpha = await seedTeam(db, 'Alpha');
    const beta = await seedTeam(db, 'Beta');
    for (const t of [alpha, beta]) {
      await db.insert(schema.devTokens).values({
        teamId: t.team.id,
        userId: t.user.id,
        tokenHash: `hash-${t.team.name}`,
        label: 'laptop',
      });
      await db.insert(schema.approvals).values({
        teamId: t.team.id,
        sessionId: t.session.id,
        eventId: t.event.id,
        ruleId: t.rule.id,
      });
    }

    await db.delete(schema.teams).where(eq(schema.teams.id, alpha.team.id));

    const teamScoped = [
      schema.memberships,
      schema.devTokens,
      schema.sessions,
      schema.events,
      schema.rules,
      schema.approvals,
    ] as const;
    for (const table of teamScoped) {
      expect(await db.$count(table, eq(table.teamId, alpha.team.id))).toBe(0);
      expect(await db.$count(table, eq(table.teamId, beta.team.id))).toBe(1);
    }
  });
});

describe('deletes', () => {
  it('removing a member revokes their dev tokens', async () => {
    const { team, user } = await seedTeam(db, 'Alpha');
    await db.insert(schema.devTokens).values({ teamId: team.id, userId: user.id, tokenHash: 'hash-1', label: 'laptop' });

    await db.delete(schema.memberships).where(eq(schema.memberships.userId, user.id));

    expect(await db.$count(schema.devTokens)).toBe(0);
  });

  it('deleting a rule removes its approvals but keeps the events', async () => {
    const { team, session, event, rule } = await seedTeam(db, 'Alpha');
    await db.insert(schema.approvals).values({ teamId: team.id, sessionId: session.id, eventId: event.id, ruleId: rule.id });

    await db.delete(schema.rules).where(eq(schema.rules.id, rule.id));

    expect(await db.$count(schema.approvals)).toBe(0);
    expect(await db.$count(schema.events)).toBe(1);
  });
});
