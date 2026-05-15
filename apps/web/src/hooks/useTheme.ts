import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'blabber-theme';
const SYNC_EVENT = 'blabber:theme-change';

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    // localStorage unavailable
  }
  return 'light';
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // ignore
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored);

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Sync across multiple component instances on the same page via custom events
  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e as CustomEvent<Theme>).detail;
      setThemeState(t);
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    // Notify sibling instances
    window.dispatchEvent(new CustomEvent<Theme>(SYNC_EVENT, { detail: t }));
  };

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  return { theme, setTheme, toggleTheme };
}
