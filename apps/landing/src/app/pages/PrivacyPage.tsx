import { LogoMark } from '../../components/LogoMark';
import { usePublicSession } from '../../marketing/usePublicSession';
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_DESCRIPTION,
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_SECTIONS,
} from '../../content/privacy';

export function PrivacyPage() {
  const authenticated = usePublicSession();

  return (
    <div className="privacy-page">
      <a className="skip-link" href="#privacy-main">Skip to privacy policy</a>
      <header className="privacy-header">
        <a href="/" className="app-logo" aria-label="Intake home"><LogoMark size={28} /><span>intake</span></a>
        <nav aria-label="Privacy navigation">
          <a href="/#how-it-works">How it works</a>
          {!authenticated && <a href="/auth/sign-in">Sign in</a>}
          <a className="btn btn-accent btn-sm" href={authenticated ? '/app' : '/auth/sign-up'}>
            {authenticated ? 'Open Intake' : 'Start free'}
          </a>
        </nav>
      </header>

      <main id="privacy-main" tabIndex={-1}>
        <section className="privacy-intro" aria-labelledby="privacy-title">
          <span className="eyebrow">EFFECTIVE {PRIVACY_EFFECTIVE_DATE.toUpperCase()}</span>
          <h1 id="privacy-title">Privacy, <em>in plain words.</em></h1>
          <p>{PRIVACY_DESCRIPTION}</p>
        </section>

        <div className="privacy-body">
          {PRIVACY_SECTIONS.map((section, index) => (
            <section key={section.heading} aria-labelledby={`privacy-section-${index}`}>
              <span className="info-index">{String(index + 1).padStart(2, '0')} / {section.heading.toUpperCase()}</span>
              <h2 id={`privacy-section-${index}`}>{section.heading}</h2>
              {section.body.map(paragraph => (
                <p key={paragraph.slice(0, 48)}>
                  {paragraph.includes(PRIVACY_CONTACT_EMAIL) ? (
                    <>
                      {paragraph.split(PRIVACY_CONTACT_EMAIL)[0]}
                      <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>
                      {paragraph.split(PRIVACY_CONTACT_EMAIL)[1]}
                    </>
                  ) : (
                    paragraph
                  )}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>

      <footer className="privacy-footer">
        <a href="/" className="app-logo"><LogoMark size={22} /><span>intake</span></a>
        <span>Your forms, your account, your responses.</span>
        <a href={authenticated ? '/app' : '/auth/sign-in'}>
          {authenticated ? 'Open your workspace' : 'Already have an account? Sign in'}
        </a>
      </footer>
    </div>
  );
}
