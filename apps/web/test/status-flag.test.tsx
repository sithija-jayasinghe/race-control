import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusFlag, type FlagStatus } from '../src/components/status-flag.tsx';

describe('StatusFlag', () => {
  it.each<[FlagStatus, string]>([
    ['working', 'Working'],
    ['yellow', 'Yellow flag'],
    ['waiting', 'Pit lane'],
    ['blocked', 'Black flag'],
    ['idle', 'Idle'],
  ])('names %s as "%s", never colour alone', (status, label) => {
    render(<StatusFlag status={status} />);

    expect(screen.getByText(label)).toBeVisible();
  });

  it('keeps the word for screen readers when the label is hidden', () => {
    render(<StatusFlag status="blocked" hideLabel />);

    expect(screen.getByText('Black flag')).toHaveClass('sr-only');
  });
});
