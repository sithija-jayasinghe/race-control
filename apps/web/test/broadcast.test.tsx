import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../src/components/live-clock.tsx';
import { RaceControlBanner } from '../src/components/race-control-banner.tsx';
import { TeamRadioCard } from '../src/components/team-radio-card.tsx';

describe('RaceControlBanner', () => {
  it.each([
    ['yellow', 'Yellow flag'],
    ['waiting', 'Pit lane'],
    ['blocked', 'Black flag'],
  ] as const)('names the %s flag in words', (status, tag) => {
    render(<RaceControlBanner status={status} message="NIM & KAS" detail="auth/session.ts" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(tag);
    expect(banner).toHaveTextContent('RACE CONTROL');
    expect(banner).toHaveTextContent('NIM & KAS');
    expect(banner).toHaveTextContent('auth/session.ts');
  });
});

describe('TeamRadioCard', () => {
  it('shows who is talking to whom and what was said', () => {
    render(<TeamRadioCard from="NIM" to="KAS" quote="Hold your edit." />);

    expect(screen.getByRole('status')).toHaveTextContent('Team radio');
    expect(screen.getByRole('status')).toHaveTextContent('NIM → KAS');
    expect(screen.getByRole('status')).toHaveTextContent('“Hold your edit.”');
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '00:00:00'],
    [999, '00:00:00'],
    [61_000, '00:01:01'],
    [(2 * 3600 + 14 * 60 + 5) * 1000, '02:14:05'],
    [26 * 3600 * 1000, '26:00:00'],
    [-5000, '00:00:00'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
