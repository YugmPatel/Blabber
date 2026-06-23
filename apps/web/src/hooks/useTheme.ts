import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'blabber-theme';
const SYNC_EVENT = 'blabber:theme-change';

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function resolveTheme(t: Theme): ResolvedTheme {
  if (t === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', resolveTheme(t) === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // ignore
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(readStored())
  );

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    applyTheme(theme);
    setResolvedTheme(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        applyTheme(theme);
        setResolvedTheme(resolveTheme(theme));
      }
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
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
    setResolvedTheme(resolveTheme(t));
    // Notify sibling instances
    window.dispatchEvent(new CustomEvent<Theme>(SYNC_EVENT, { detail: t }));
  };

  const toggleTheme = () => setTheme(resolveTheme(theme) === 'light' ? 'dark' : 'light');

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
