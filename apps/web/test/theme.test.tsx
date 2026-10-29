import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeMenu } from '../src/components/theme-menu.tsx';
import { ThemeProvider, readThemeChoice } from '../src/lib/theme.tsx';
import { setSystemDark } from './setup.ts';

const isDark = () => document.documentElement.classList.contains('dark');

function renderMenu() {
  return render(
    <ThemeProvider>
      <ThemeMenu />
    </ThemeProvider>,
  );
}

async function choose(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Theme' }));
  await user.click(await screen.findByRole('menuitemradio', { name: label }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('is dark by default, even when the system prefers light', () => {
    renderMenu();

    expect(isDark()).toBe(true);
  });

  it('lets you pick light, and remembers it', async () => {
    renderMenu();

    await choose('Light');

    expect(isDark()).toBe(false);
    expect(localStorage.getItem('rc-theme')).toBe('light');
  });

  it('can follow the system setting, including live changes', async () => {
    renderMenu();
    await choose('System');
    expect(isDark()).toBe(false);
    expect(localStorage.getItem('rc-theme')).toBe('system');

    act(() => setSystemDark(true));

    expect(isDark()).toBe(true);
  });

  it('forgets the saved choice when you go back to dark', async () => {
    renderMenu();
    await choose('Light');

    await choose('Dark');

    expect(isDark()).toBe(true);
    expect(localStorage.getItem('rc-theme')).toBeNull();
  });

  it('falls back to dark when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readThemeChoice()).toBe('dark');
  });
});
