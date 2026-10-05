import { useEffect, useId, useState, type ReactNode } from 'react';
import { CREATOR } from '../content/site';
import { LogoMark } from '../components/LogoMark';
import { useScrolled, useScrollProgress } from './motion';

export function StartLink({
  authenticated,
  children,
  className = 'mk-button mk-button--primary',
}: {
  authenticated: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a className={className} href={authenticated ? '/app' : '/auth/sign-up'}>
      <span>{children ?? (authenticated ? 'Open Intake' : 'Start free')}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
        <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

const MAIN_LINKS = [
  ['Why Intake', '#product'],
  ['How it works', '#how-it-works'],
  ['Create', '#creation'],
  ['Edit', '#editing'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
] as const;

/** Thin accent line at the top of the viewport that fills as the page is read. */
function ScrollProgress() {
  const progress = useScrollProgress();
  return <div className="mk-progress" aria-hidden="true" style={{ transform: `scaleX(${progress})` }} />;
}

export function MarketingNav({ authenticated }: { authenticated: boolean }) {
  const scrolled = useScrolled(14);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelId = useId();

  // The sheet is a real overlay on small screens: lock the body, close on Escape, and clear it when
  // the viewport grows back to the desktop layout.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1001px)') : null;
    const onChange = () => { if (media?.matches) setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    media?.addEventListener('change', onChange);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      media?.removeEventListener('change', onChange);
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <>
      <ScrollProgress />
      <header className={`mk-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="mk-container mk-header__inner">
          <a className="mk-brand" href="/" aria-label="Intake home">
            <span className="mk-brand__mark"><LogoMark size={27} /></span>
            <span>intake</span>
          </a>

          <nav className="mk-nav-links" aria-label="Main navigation">
            {MAIN_LINKS.map(([label, href]) => (
              <a key={label} href={href}><span>{label}</span></a>
            ))}
          </nav>

          <div className="mk-header__actions">
            {!authenticated && <a className="mk-sign-in" href="/auth/sign-in">Sign in</a>}
            <StartLink authenticated={authenticated} className="mk-button mk-button--primary mk-button--nav" />
          </div>

          <button
            type="button"
            className="mk-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            onClick={() => setMenuOpen(open => !open)}
          >
            <span>{menuOpen ? 'Close' : 'Menu'}</span>
            <span className={`mk-menu-toggle__bars${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
              <i /><i /><i />
            </span>
          </button>
        </div>
      </header>

      <div
        className={`mk-sheet${menuOpen ? ' is-open' : ''}`}
        id={panelId}
        hidden={!menuOpen}
      >
        <button type="button" className="mk-sheet__scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setMenuOpen(false)} />
        <nav className="mk-sheet__panel" aria-label="Mobile navigation">
          {MAIN_LINKS.map(([label, href], index) => (
            <a key={label} href={href} style={{ '--i': index } as React.CSSProperties} onClick={() => setMenuOpen(false)}>
              <span>{label}</span>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
          <div className="mk-sheet__actions">
            {!authenticated && <a className="mk-button mk-button--secondary" href="/auth/sign-in" onClick={() => setMenuOpen(false)}>Sign in</a>}
            <StartLink authenticated={authenticated} className="mk-button mk-button--primary" />
          </div>
        </nav>
      </div>
    </>
  );
}

const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      ['Why Intake', '#product'],
      ['How it works', '#how-it-works'],
      ['Create a form', '#creation'],
      ['Edit a form', '#editing'],
    ],
  },
  {
    heading: 'Project',
    links: [
      ['GitHub', CREATOR.github, true],
      ['Contributing', `${CREATOR.github}/blob/main/README.md#contributing`, true],
      ['License', `${CREATOR.github}/blob/main/LICENSE`, true],
      ['Pricing', '/pricing'],
    ],
  },
] as const;

export function MarketingFooter({ authenticated }: { authenticated: boolean }) {
  return (
    <footer className="mk-footer">
      <div className="mk-container">
        <div className="mk-footer__top">
          <div className="mk-footer__brand">
            <a className="mk-brand" href="/" aria-label="Intake home">
              <span className="mk-brand__mark"><LogoMark size={26} /></span>
              <span>intake</span>
            </a>
            <p>Describe a form, look it over, and it lands in your Google Forms account. Editing the ones you already have works the same way.</p>
            {!authenticated && <StartLink authenticated={false} className="mk-button mk-button--secondary mk-footer__cta" />}
          </div>

          {FOOTER_COLUMNS.map(column => (
            <nav className="mk-footer__column" aria-label={column.heading} key={column.heading}>
              <h2>{column.heading}</h2>
              {column.links.map(([label, href, external]) => (
                <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{label}</a>
              ))}
            </nav>
          ))}

          <div className="mk-footer__column mk-footer__column--google">
            <h2>Google Forms</h2>
            <p>Your forms, your account, your responses. Intake sets up the questions and hands Google a form that behaves like any other.</p>
            <a href="https://forms.google.com" target="_blank" rel="noreferrer">Open Google Forms <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div className="mk-footer__bottom">
          <span>© {new Date().getFullYear()} Intake</span>
          <span className="mk-footer__credit">
            Designed by <a href={CREATOR.github} target="_blank" rel="noreferrer">{CREATOR.credit}</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
