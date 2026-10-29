import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';

describe('App shell', () => {
  it('shows the rail on desktop and the tab bar on phones, with the current page marked', () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      const links = within(nav).getAllByRole('link');
      expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['Pit wall', 'Team', 'Settings']);
      expect(within(nav).getByRole('link', { name: 'Pit wall' })).toHaveAttribute('aria-current', 'page');
    }
  });

  it('names the page and the brand, and counts agents by status with words for screen readers', () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Pit wall' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Race Control' })).toBeInTheDocument();
    const counters = screen.getByLabelText('Agents by status');
    expect(within(counters).getByText('Yellow flag')).toHaveClass('sr-only');
  });
});
