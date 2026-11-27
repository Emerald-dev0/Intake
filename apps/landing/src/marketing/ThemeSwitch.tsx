import { useId, useRef } from 'react';
import { flushSync } from 'react-dom';
import { applyTheme, useTheme, type Theme } from '../lib/theme';

type ViewTransitionLike = { ready: Promise<void> };
type DocumentWithTransitions = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike };

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The marketing theme switch: a small sun/moon pill. On click the new theme spreads from the
 * switch in a growing circle (View Transitions API). Browsers without it, and anyone who asked
 * for reduced motion, get an instant change instead. Same storage and attribute as ThemeToggle.
 */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLButtonElement | null>(null);
  const maskId = `mk-switch-moon-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const dark = theme === 'dark';

  const change = () => {
    const next: Theme = dark ? 'light' : 'dark';
    const doc = document as DocumentWithTransitions;
    const commit = () => {
      applyTheme(next);
      flushSync(() => setTheme(next));
    };
    if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion() || !ref.current) {
      commit();
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;
    root.classList.add('is-theme-switching');
    const transition = doc.startViewTransition(commit);
    transition.ready
      .then(() => {
        const animation = root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 720, easing: 'cubic-bezier(.22, 1, .36, 1)', pseudoElement: '::view-transition-new(root)' },
        );
        return animation.finished;
      })
      .catch(() => undefined)
      .finally(() => root.classList.remove('is-theme-switching'));
  };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`mk-switch${dark ? ' is-dark' : ''}${className ? ` ${className}` : ''}`}
      onClick={change}
    >
      <span className="mk-switch__stars" aria-hidden="true"><i /><i /><i /></span>
      <span className="mk-switch__knob" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
          <mask id={maskId}>
            <rect width="24" height="24" fill="#fff" />
            <circle className="mk-switch__bite" cx="24" cy="4" r="7" fill="#000" />
          </mask>
          <circle className="mk-switch__disc" cx="12" cy="12" r="5" mask={`url(#${maskId})`} />
          <g className="mk-switch__rays">
            <path d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7" />
          </g>
        </svg>
      </span>
    </button>
  );
}
