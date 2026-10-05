import type { ReactNode } from 'react';
import { CREATOR } from '../content/site';
import { LogoMark } from '../components/LogoMark';

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
      {children ?? (authenticated ? 'Open Intake' : 'Try Intake Free')}
      <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
        <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

const MAIN_LINKS = [
  ['Product', '#product'],
  ['How it works', '#how-it-works'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
] as const;

export function MarketingNav({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="mk-header">
      <div className="mk-container mk-header__inner">
        <a className="mk-brand" href="/" aria-label="Intake home">
          <LogoMark size={27} />
          <span>intake</span>
        </a>

        <nav className="mk-nav-links" aria-label="Main navigation">
          {MAIN_LINKS.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
        </nav>

        <div className="mk-header__actions">
          {!authenticated && <a className="mk-sign-in" href="/auth/sign-in">Sign in</a>}
          <StartLink authenticated={authenticated} className="mk-button mk-button--primary mk-button--nav" />
        </div>

        <details className="mk-mobile-menu">
          <summary aria-label="Open navigation menu">
            <span>Menu</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
              <path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </summary>
          <nav className="mk-mobile-menu__panel" aria-label="Mobile navigation">
            {MAIN_LINKS.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
            {!authenticated && <a href="/auth/sign-in">Sign in</a>}
            <StartLink authenticated={authenticated} className="mk-button mk-button--primary" />
          </nav>
        </details>
      </div>
    </header>
  );
}

export function MarketingFooter({ authenticated }: { authenticated: boolean }) {
  return (
    <footer className="mk-footer">
      <div className="mk-container">
        <div className="mk-footer__top">
          <div className="mk-footer__brand">
            <a className="mk-brand" href="/" aria-label="Intake home">
              <LogoMark size={25} />
              <span>intake</span>
            </a>
            <p>A natural-language way to create and manage the Google Forms you already use.</p>
          </div>
          <nav className="mk-footer__links" aria-label="Footer navigation">
            <div>
              <h2>Product</h2>
              <a href="#product">Why Intake</a>
              <a href="#how-it-works">How it works</a>
              <a href="#creation">Create a form</a>
              <a href="#editing">Edit a form</a>
            </div>
            <div>
              <h2>Explore</h2>
              <a href="/pricing">Pricing</a>
              <a href="#faq">FAQ</a>
              {!authenticated && <a href="/auth/sign-in">Sign in</a>}
              <StartLink authenticated={authenticated} className="mk-footer__start" />
            </div>
          </nav>
        </div>
        <div className="mk-footer__bottom">
          <span>© {new Date().getFullYear()} Intake</span>
          <span>Google Forms is a Google product. Intake is independent.</span>
          <span>Built by <a href={CREATOR.github} target="_blank" rel="noreferrer">{CREATOR.displayName}</a></span>
        </div>
      </div>
    </footer>
  );
}
