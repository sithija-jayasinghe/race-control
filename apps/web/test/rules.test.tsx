import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { chipsToTool, toolsToChips } from '../src/pages/rules.tsx';
import { TEAM, fakeServer, renderApp, rule } from './helpers.tsx';

const starter = () => [
  rule({ mode: 'enforce' }),
  rule({ name: 'Migrations need a lead', pattern: '**/migrations/**', action: 'approve' }),
  rule({ name: 'Publishing needs a lead', tool: 'Bash', pattern: 'npm publish*', action: 'approve', enabled: false }),
];

describe('Rules page', () => {
  it('lists the rules with their flag, mode and 7-day count', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.rules.set(TEAM.id, starter());
    renderApp(`/t/${TEAM.id}/rules`);

    const list = await screen.findByRole('list', { name: 'Rules' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('STOPBlock, liveNever touch .env filesEdit · MultiEdit · Write · NotebookEdit **/.env*4');
    expect(rows[1]).toHaveTextContent('PITNeeds a lead, shadowMigrations need a lead');
    expect(rows[2]).toHaveTextContent('Publishing needs a lead (off)');
    expect(screen.getByText(/1 live · ◌ 1 shadow/)).toBeInTheDocument();
  });

  it('lets a lead turn a rule live, and off', async () => {
    const server = fakeServer({ signedIn: true });
    const rules = starter();
    server.state.rules.set(TEAM.id, rules);
    renderApp(`/t/${TEAM.id}/rules`);

    const mode = await screen.findByRole('radiogroup', { name: 'Migrations need a lead mode' });
    await userEvent.click(within(mode).getByRole('radio', { name: 'Live' }));
    expect(server.callsTo(`PATCH /teams/${TEAM.id}/rules/${rules[1]!.id}`)[0]?.body).toEqual({ mode: 'enforce' });

    await userEvent.click(screen.getByRole('switch', { name: 'Never touch .env files on' }));
    expect(server.callsTo(`PATCH /teams/${TEAM.id}/rules/${rules[0]!.id}`)[0]?.body).toEqual({ enabled: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Never touch .env files on' })).toHaveAttribute('aria-checked', 'false'));
  });

  it('shows developers the rules without the controls', async () => {
    const server = fakeServer({ signedIn: true, role: 'developer' });
    server.state.rules.set(TEAM.id, starter());
    renderApp(`/t/${TEAM.id}/rules`);

    await screen.findByRole('list', { name: 'Rules' });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New rule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Never touch .env files' })).not.toBeInTheDocument();
  });

  it('tests a file or command and lights up the rules it hits', async () => {
    const server = fakeServer({ signedIn: true });
    const rules = starter();
    server.state.rules.set(TEAM.id, rules);
    server.on(`POST /teams/${TEAM.id}/rules/test`, () => ({ status: 200, body: { decision: 'deny', ruleId: rules[0]!.id, shadowIds: [rules[1]!.id] } }));
    renderApp(`/t/${TEAM.id}/rules`);

    await userEvent.type(await screen.findByRole('textbox', { name: 'Try a file path or command' }), 'apps/api/.env');

    expect(await screen.findByText(/Stopped/)).toBeInTheDocument();
    expect(screen.getByText(/Stopped/).closest('p')).toHaveTextContent('● Stopped by Never touch .env files · Shadow: Migrations need a lead');
    expect(server.callsTo(`POST /teams/${TEAM.id}/rules/test`).at(-1)?.body).toEqual({ input: 'apps/api/.env' });
  });

  it('adds a rule in shadow mode from the drawer, with a live preview', async () => {
    const server = fakeServer({ signedIn: true });
    server.state.rules.set(TEAM.id, starter());
    server.on(`POST /teams/${TEAM.id}/rules/preview`, () => ({ status: 200, body: { count: 3, examples: ['pnpm-lock.yaml'] } }));
    renderApp(`/t/${TEAM.id}/rules`);

    await userEvent.click(await screen.findByRole('button', { name: /New rule/ }));
    const form = screen.getByRole('form', { name: 'New rule' });
    await userEvent.click(within(form).getByRole('button', { name: 'Add in shadow' }));
    expect(within(form).getByText('Name the rule')).toBeInTheDocument();

    await userEvent.type(within(form).getByRole('textbox', { name: 'Rule name' }), 'Lockfiles need a lead');
    await userEvent.click(within(form).getByRole('radio', { name: 'Needs a lead' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Write' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'Pattern' }), '**/pnpm-lock.yaml');
    expect(await within(form).findByText(/Would have caught/)).toHaveTextContent('Would have caught 3 in the last 7 days: pnpm-lock.yaml');
    await userEvent.click(within(form).getByRole('button', { name: 'Add in shadow' }));

    expect(server.callsTo(`POST /teams/${TEAM.id}/rules`)[0]?.body).toEqual({
      name: 'Lockfiles need a lead',
      tool: 'Edit|MultiEdit|NotebookEdit',
      pattern: '**/pnpm-lock.yaml',
      action: 'approve',
    });
    expect(await screen.findByRole('button', { name: 'Lockfiles need a lead' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New rule' })).not.toBeInTheDocument();
  });

  it('edits a rule from its name', async () => {
    const server = fakeServer({ signedIn: true });
    const rules = starter();
    server.state.rules.set(TEAM.id, rules);
    renderApp(`/t/${TEAM.id}/rules`);

    await userEvent.click(await screen.findByRole('button', { name: 'Migrations need a lead' }));
    const form = screen.getByRole('form', { name: 'Edit rule' });
    const pattern = within(form).getByRole('textbox', { name: 'Pattern' });
    await userEvent.clear(pattern);
    await userEvent.type(pattern, '**/schema.ts');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    expect(server.callsTo(`PATCH /teams/${TEAM.id}/rules/${rules[1]!.id}`)[0]?.body).toMatchObject({ pattern: '**/schema.ts', action: 'approve' });
  });

  it('offers the starter rules to a lead whose team has none', async () => {
    const server = fakeServer({ signedIn: true });
    server.on(`POST /teams/${TEAM.id}/rules/starter`, () => {
      server.state.rules.set(TEAM.id, starter());
      return { status: 204 };
    });
    renderApp(`/t/${TEAM.id}/rules`);

    await userEvent.click(await screen.findByRole('button', { name: 'Add the starter rules' }));

    expect(await screen.findByRole('list', { name: 'Rules' })).toBeInTheDocument();
  });
});

describe('Rules page for a developer on a team with no rules', () => {
  it('says a lead adds them, with no button', async () => {
    fakeServer({ signedIn: true, role: 'developer' });
    renderApp(`/t/${TEAM.id}/rules`);

    expect(await screen.findByText('A lead can add rules here. Until then, nothing is blocked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add the starter rules' })).not.toBeInTheDocument();
  });
});

describe('tool chips', () => {
  it('turn a tool list into chips and back, keeping tools no chip covers', () => {
    expect(toolsToChips('Edit|MultiEdit|Write|NotebookEdit')).toEqual({ chips: ['Edit', 'Write'], extra: [] });
    expect(toolsToChips('Bash|mcp__github__merge')).toEqual({ chips: ['Bash'], extra: ['mcp__github__merge'] });
    expect(chipsToTool(['Write', 'Edit'])).toBe('Edit|MultiEdit|NotebookEdit|Write');
    expect(chipsToTool(['Bash', '*'])).toBe('*');
    expect(chipsToTool(['Bash'], ['mcp__github__merge'])).toBe('Bash|mcp__github__merge');
  });
});
