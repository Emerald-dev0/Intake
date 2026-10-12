import { useCallback, useEffect, useState } from 'react';

/**
 * Two-theme engine. Dark is the product's native look; light is a full remap of the same
 * semantic variables, never a separate stylesheet — every surface flips by changing one
 * `data-theme` attribute on <html>.
 *
 * Initial choice: an explicit saved preference wins; otherwise the OS preference; otherwise
 * dark. The attribute is applied synchronously on first paint (see the inline script in
 * index.html) so there is no theme flash.
 */

export type Theme = 'dark' | 'light';
export const THEMES: Theme[] = ['dark', 'light'];
const STORAGE_KEY = 'intake-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

function systemTheme(): Theme {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
  } catch {
    // A hostile or headless environment must never break rendering.
  }
  return 'dark';
}

export function storedTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function resolveTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function themeLabel(theme: Theme): string {
  return theme === 'dark' ? 'Dark' : 'Light';
}

/** The single place the attribute is written, so renders and tests agree. */
export function applyTheme(theme: Theme): void {
  try {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0c0b' : '#f5f0e6');
  } catch {
    // Never let chrome preferences break the app shell.
  }
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode and full disks keep the session-only choice.
  }
}

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void } {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== 'undefined' && isTheme(document.documentElement.dataset.theme)) {
      return document.documentElement.dataset.theme;
    }
    return resolveTheme();
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // A change in another tab follows without a reload.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && isTheme(event.newValue)) setThemeState(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(current => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      persistTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
