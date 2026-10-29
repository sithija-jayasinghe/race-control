import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'rc-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
/** Race Control is designed dark-first (docs/design/UI.md). */
const DEFAULT_CHOICE: ThemeChoice = 'dark';

/** The saved choice. Storage can be unavailable (private windows), so failures fall back to the default. */
export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

function saveThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === DEFAULT_CHOICE) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not saved; the choice still applies until the page is reloaded.
  }
}

function systemPrefersDark() {
  return window.matchMedia(DARK_QUERY).matches;
}

type ThemeContextValue = { choice: ThemeChoice; isDark: boolean; setChoice: (choice: ThemeChoice) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readThemeChoice);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const isDark = choice === 'dark' || (choice === 'system' && systemDark);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const setChoice = useCallback((next: ThemeChoice) => {
    saveThemeChoice(next);
    setChoiceState(next);
  }, []);

  const value = useMemo(() => ({ choice, isDark, setChoice }), [choice, isDark, setChoice]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
