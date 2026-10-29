import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LightsOut } from '../src/components/lights-out.tsx';
import { media } from './setup.ts';

const litCount = () => document.querySelectorAll('[data-lit="true"]').length;
const overlay = () => screen.queryByTestId('lights-out');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LightsOut', () => {
  it('lights five pairs one by one, then goes out and disappears', () => {
    render(<LightsOut />);
    expect(litCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(550 * 3);
    });
    expect(litCount()).toBe(6);

    act(() => {
      vi.advanceTimersByTime(550 * 2);
    });
    expect(litCount()).toBe(10);

    act(() => {
      vi.advanceTimersByTime(650);
    });
    expect(litCount()).toBe(0);
    expect(screen.getByText('Lights out')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(450 + 600);
    });
    expect(overlay()).toBeNull();
  });

  it('can be skipped with a click or a key', () => {
    render(<LightsOut />);
    fireEvent.click(overlay()!);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(overlay()).toBeNull();

    sessionStorage.clear();
    render(<LightsOut />);
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(overlay()).toBeNull();
  });

  it('shows only once per browser session', () => {
    const first = render(<LightsOut />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    first.unmount();

    render(<LightsOut />);

    expect(overlay()).toBeNull();
  });

  it('never shows when the system asks for reduced motion', () => {
    media.reducedMotion = true;

    render(<LightsOut />);

    expect(overlay()).toBeNull();
  });
});
