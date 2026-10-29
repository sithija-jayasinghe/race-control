import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimingTower, gapLabel, raceOrder, type Driver } from '../src/components/timing-tower.tsx';

const driver = (overrides: Partial<Driver>): Driver => ({
  id: overrides.code ?? 'X',
  code: 'XXX',
  name: 'Someone',
  agent: 'claude_code',
  status: 'working',
  laps: 0,
  sectors: [],
  ...overrides,
});

const drivers = [
  driver({ id: 'a', code: 'AMA', name: 'Amaya', agent: 'codex', status: 'waiting', laps: 37 }),
  driver({ id: 'n', code: 'NIM', name: 'Nimal', status: 'yellow', laps: 44 }),
  driver({ id: 'j', code: 'JAN', name: 'Janith', status: 'blocked', laps: 30 }),
  driver({ id: 'r', code: 'RUW', name: 'Ruwan', laps: 36 }),
];

describe('raceOrder', () => {
  it('puts the most laps first, breaking ties by code', () => {
    const tied = [driver({ code: 'ZED', laps: 5 }), driver({ code: 'ABE', laps: 5 }), driver({ code: 'MID', laps: 9 })];

    expect(raceOrder(tied).map((d) => d.code)).toEqual(['MID', 'ABE', 'ZED']);
  });
});

describe('gapLabel', () => {
  it('says LEAD, laps behind, PIT or STOP', () => {
    expect(gapLabel(driver({ laps: 44 }), 44, 1)).toBe('LEAD');
    expect(gapLabel(driver({ laps: 36 }), 44, 3)).toBe('+8');
    expect(gapLabel(driver({ status: 'waiting', laps: 44 }), 44, 1)).toBe('PIT');
    expect(gapLabel(driver({ status: 'blocked', laps: 10 }), 44, 4)).toBe('STOP');
  });
});

describe('TimingTower', () => {
  it('lists drivers in race order with a full description for screen readers', () => {
    render(<TimingTower drivers={drivers} />);

    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'P1, Nimal, Claude Code, Yellow flag, 44 laps',
      'P2, Amaya, Codex, Pit lane, 37 laps',
      'P3, Ruwan, Claude Code, Working, 36 laps',
      'P4, Janith, Claude Code, Black flag, 30 laps',
    ]);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('LEAD'),
      expect.stringContaining('PIT'),
      expect.stringContaining('+8'),
      expect.stringContaining('STOP'),
    ]);
    expect(screen.getByText('LAP 44')).toBeInTheDocument();
  });

  it('reports which driver is picked and marks the selected one', async () => {
    const onSelect = vi.fn();
    render(<TimingTower drivers={drivers} selectedId="r" onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: /Janith/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: 'JAN' }));
    expect(screen.getByRole('button', { name: /Ruwan/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Janith/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
