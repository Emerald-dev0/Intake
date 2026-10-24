import { useEffect, useId, useState, type ReactNode } from 'react';
import { CREATOR } from '../content/site';
import { LogoMark } from '../components/LogoMark';
import { GoogleFormsLogo, TypeformLogo } from '../components/ProviderLogos';
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
      <span>{children ?? (authenticated ? 'Open Intake' : 'Sign up free')}</span>
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
  ['Providers', '#providers'],
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
      ['Why Intake', '/#product'],
      ['See the proof', '/#proof'],
      ['Compare', '/vs'],
      ['Templates', '/templates'],
      ['Guides', '/guides'],
      ['Pricing', '/pricing'],
    ],
  },
  {
    heading: 'Resources',
    links: [
      ['Changelog', '/changelog'],
      ['Trust & permissions', '/trust'],
      ['Contact', 'mailto:support@intake.calder.click'],
      ['GitHub', CREATOR.github, true],
      ['Calder', 'https://calder.click', true],
    ],
  },
  {
    heading: 'Legal',
    links: [
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Contributing', `${CREATOR.github}/blob/main/README.md#contributing`, true],
      ['License', `${CREATOR.github}/blob/main/LICENSE`, true],
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
            <p>Describe a form, look it over, and it lands in the account you connected — Google Forms or Typeform today, with the next providers already chosen. Editing the forms you own works the same way.</p>
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

          <div className="mk-footer__column mk-footer__column--providers">
            <h2>Providers</h2>
            <p>Your forms, your account, your responses — whichever tool you connect. Two work today; four more are queued.</p>
            <ul className="mk-footer__providers">
              <li>
                <a href="https://forms.google.com" target="_blank" rel="noreferrer">
                  <GoogleFormsLogo size={16} tone="mono" label={null} />
                  Google Forms <span aria-hidden="true">↗</span>
                </a>
                <small>Create and edit in place</small>
              </li>
              <li>
                <a href="https://www.typeform.com" target="_blank" rel="noreferrer">
                  <TypeformLogo height={11} tone="mono" />
                  <span aria-hidden="true">↗</span>
                </a>
                <small>Create and import</small>
              </li>
            </ul>
            <p className="mk-footer__roadmap">Next in line: SurveyMonkey, Google Sheets, Jira, n8n. <a href="/#providers">See the provider list</a></p>
          </div>
        </div>

        <div className="mk-footer__maker">
          <p><strong>Support.</strong> Write to <a href="mailto:support@intake.calder.click">support@intake.calder.click</a> — a human reads everything.</p>
          <p>You'll hear from the founder with regular updates.</p>
        </div>

        <div className="mk-footer__bottom">
          <span>© {new Date().getFullYear()} Intake</span>
          <span className="mk-footer__credit">
            Designed by <a href={CREATOR.site} target="_blank" rel="noreferrer">{CREATOR.credit}</a> · Email by <a href="https://calder.click" target="_blank" rel="noreferrer">Calder</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
