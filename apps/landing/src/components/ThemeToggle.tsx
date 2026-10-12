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
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}
