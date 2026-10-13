import { themeLabel, useTheme } from '../lib/theme';

/**
 * Theme picker. One control, three homes (marketing header, mobile sheet, workspace
 * account menu): the visuals come from the caller's className so it never looks generic.
 */
export function ThemeToggle({ className = '', menuItem = false }: { className?: string; menuItem?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  if (menuItem) {
    return (
      <button type="button" className={className} onClick={toggleTheme} aria-live="polite">
        Theme: {themeLabel(theme)} → {themeLabel(next)}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={`Switch to ${next} mode (currently ${theme} mode)`}
      title={`Switch to ${next} mode`}
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {theme === 'dark' ? <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
      </svg>
    </button>
  );
}
