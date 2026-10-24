import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANGELOG, COMPARISON_ROWS, USE_CASES, WORKFLOW_STEPS } from '../content/site';
import { MarketingFooter, MarketingNav, StartLink } from './MarketingChrome';
import { Arrow, Check, Reveal, SectionIntro } from './MarketingSections';
import { MobileActionBar } from './MobileActionBar';
import { usePageMeta, webPageSchema } from './usePageMeta';
import { usePublicSession } from './usePublicSession';
import { useSiteAnalytics } from '../lib/analytics';
import { EDIT_LIMITS } from '../lib/edit-limits';
import type { AnalyticsPath } from '../lib/analytics';

/** Shared shell for the content hubs: nav, page head, footer, action bar, metadata. */
function HubShell({ path, title, description, eyebrow, heading, lede, children }: {
  path: AnalyticsPath;
  title: string;
  description: string;
  eyebrow: string;
  heading: React.ReactNode;
  lede: string;
  children: React.ReactNode;
}) {
  const authenticated = usePublicSession();
  useSiteAnalytics(path);
  usePageMeta({ title, description, path, schema: webPageSchema(path, title, description) });
  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MarketingNav authenticated={authenticated} />
      <main id="main-content" tabIndex={-1}>
        <section className="mk-section mk-hub-head" aria-labelledby="mk-hub-title">
          <div className="mk-container">
            <span className="mk-eyebrow">{eyebrow}</span>
            <h1 id="mk-hub-title">{heading}</h1>
            <p className="mk-hub-lede">{lede}</p>
          </div>
        </section>
        {children}
        <section className="mk-section mk-hub-cta" aria-label="Get started">
          <div className="mk-container">
            <Reveal variant="rise">
              <h2>Your first form is one sentence away.</h2>
              <p>Free during launch · 20 credits daily · No card needed</p>
              <StartLink authenticated={authenticated} />
            </Reveal>
          </div>
        </section>
      </main>
      <MarketingFooter authenticated={authenticated} />
      <MobileActionBar authenticated={authenticated} />
    </div>
  );
}

function CompareTable() {
  return (
    <div className="mk-compare__scroll">
      <table className="mk-compare__table">
        <caption>Intake compared with Google&rsquo;s built-in AI help, Typeform AI, and asking a chatbot</caption>
        <thead>
          <tr>
            <th scope="col"><span className="mk-compare__th-label">Capability</span></th>
            <th scope="col" className="is-intake"><span className="mk-compare__th-label">Intake</span></th>
            <th scope="col"><span className="mk-compare__th-label">Google&rsquo;s built-in AI</span></th>
            <th scope="col"><span className="mk-compare__th-label">Typeform AI</span></th>
            <th scope="col"><span className="mk-compare__th-label">ChatGPT</span></th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map(row => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="is-intake"><Check />{row.intake}</td>
              <td>{row.googleAi}</td>
              <td>{row.typeformAi}</td>
              <td>{row.chatgpt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VsPage() {
  return (
    <HubShell
      path="/vs"
      title="Intake vs Typeform AI, Google AI & ChatGPT — AI form builder comparison"
      description="How Intake compares with Google's built-in AI, Typeform AI, and ChatGPT: one description becomes a real form in the tool you choose, approval-first, with in-place editing for the forms you own."
      eyebrow="INTAKE VS THE ALTERNATIVES"
      heading={<>Intake vs Typeform AI, Google AI, and ChatGPT.</>}
      lede="The alternatives draft text or lock you into one platform. Intake builds the actual form — in Google Forms or Typeform today, in whichever tool joins next — shows you every question first, and edits your existing forms without making copies."
    >
      <section className="mk-section" aria-label="Comparison table">
        <div className="mk-container"><CompareTable /></div>
      </section>
      <section className="mk-section" aria-label="Head-to-head notes">
        <div className="mk-container mk-vs-notes">
          <Reveal variant="fade">
            <h2>Intake vs Typeform AI</h2>
            <p>Both can end up as a Typeform — the difference is where the decision happens. Typeform AI drafts inside Typeform, in Typeform's editor, with Typeform's limits. Intake gives you the question list first, in one conversation, and then creates the form in <em>either</em> Google Forms or Typeform. If your team lives in Google Forms, Typeform AI means migrating; Intake means staying. If you want Typeform, you get the same Typeform — with a review step in front of it.</p>
          </Reveal>
          <Reveal variant="fade">
            <h2>Intake vs Google&rsquo;s built-in AI</h2>
            <p>Google&rsquo;s form help drafts questions inside the editor, then leaves you to fix types, required flags, and routing by hand — and editing an existing form means the same manual work again. Intake proposes the full question list for approval before anything exists, and revises existing forms from a sentence. Same destination, far less clicking.</p>
          </Reveal>
          <Reveal variant="fade">
            <h2>Intake vs just asking ChatGPT</h2>
            <p>A chatbot writes question text you then retype into Google Forms or Typeform field by field — including every choice, section, and required toggle. Intake skips the transcription: the proposal becomes the form with one confirmation, and follow-up changes (“make email optional”) apply to the live form instead of starting over.</p>
          </Reveal>
          <p className="mk-hub-updated">Updated October 2026. Capabilities change; the approval-first workflow does not.</p>
        </div>
      </section>
    </HubShell>
  );
}

function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return <button type="button" className="mk-template__copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>;
}

export function TemplatesPage() {
  const authenticated = usePublicSession();
  return (
    <HubShell
      path="/templates"
      title="Form prompt templates — teachers, events, HR, clinics, student orgs | Intake"
      description="Stealable AI form prompts for teachers, event organizers, HR teams, clinics, and student orgs. Copy a prompt, paste it into Intake, approve the questions."
      eyebrow="PROMPT TEMPLATES"
      heading={<>Start from a prompt that already works.</>}
      lede="Every template below is a real request shape: copy it, change the details, and Intake proposes the question list for your approval."
    >
      <section className="mk-section" aria-label="Templates">
        <div className="mk-container">
          <ul className="mk-template-grid">
            {USE_CASES.map((useCase, index) => (
              <Reveal as="li" className="mk-template-card" key={useCase.audience} delay={index * 60} variant="rise">
                <span className="mk-eyebrow">{useCase.audience}</span>
                <h2>{useCase.headline}</h2>
                <p>{useCase.body}</p>
                <div className="mk-use-case-prompt">
                  <span>THE PROMPT</span>
                  <p>“{useCase.prompt}”</p>
                </div>
                <div className="mk-template__actions">
                  <CopyPrompt prompt={useCase.prompt} />
                  {authenticated ? (
                    <Link className="mk-text-link" to="/app/forms" state={{ initialPrompt: useCase.prompt }}>Use it now <Arrow /></Link>
                  ) : (
                    <a className="mk-text-link" href="/auth/sign-up">Sign up free <Arrow /></a>
                  )}
                </div>
              </Reveal>
            ))}
          </ul>
          <p className="mk-hub-updated">Updated October 2026. New templates arrive with the changelog.</p>
        </div>
      </section>
    </HubShell>
  );
}

const GUIDE_STEPS = [
  'Write one description of what the form should collect — who answers, what you need to know, anything required.',
  'Read Intake’s proposed question list. Check types, choices, and required flags the way you would proofread.',
  'Ask for changes in plain words until the proposal matches what you had in mind.',
  'Confirm once. Intake creates the form in the account you connected — Google Forms or Typeform today — with the same links and responses tab you already use.',
  'Share the link. Answers land in that provider; Intake never sees them.',
] as const;

export function GuidesPage() {
  return (
    <HubShell
      path="/guides"
      title="How to create a Google Form or Typeform with AI — Intake guides"
      description="Create a Google Form or Typeform with AI in five steps: describe what to collect, review the proposed questions, adjust in plain words, confirm, and share. Free plan, 20 daily credits."
      eyebrow="GUIDES"
      heading={<>How to create a form with AI.</>}
      lede="The whole workflow in five steps. Answer first, detail after — the way you would explain it to a colleague."
    >
      <section className="mk-section" aria-label="The guide">
        <div className="mk-container mk-guide">
          <ol className="mk-guide__steps">
            {GUIDE_STEPS.map((step, index) => (
              <Reveal as="li" key={step} delay={index * 60} variant="rise">
                <span className="mk-step__number">{String(index + 1).padStart(2, '0')}</span>
                <p>{step}</p>
              </Reveal>
            ))}
          </ol>
          <Reveal variant="fade">
            <h2>Editing works the same way</h2>
            <p>Point Intake at a Google Form you already have and describe the change — “make email optional, then move phone below it”. Intake reads the live form, proposes the edit, and updates that same form once you confirm. No second copy, ever. Typeform creation and import work today; editing a Typeform is the next step.</p>
            <h2>What it costs</h2>
            <p>A standard form is about 2 credits and a simple edit is 1. The Free plan renews 20 credits daily at no cost and no card, so the guide above is free to follow every day.</p>
            <p className="mk-hub-updated">Updated October 2026.</p>
          </Reveal>
          <SectionIntro eyebrow="THE SHORT VERSION" titleId="mk-guide-steps" title={<>Describe. Understand. Adjust. Create.</>}>
            The same four steps as the homepage, because the product is the process.
          </SectionIntro>
          <ol className="mk-steps">
            {WORKFLOW_STEPS.map((step, index) => (
              <Reveal as="li" className="mk-step" key={step.title} delay={index * 80} variant="rise">
                <span className="mk-step__number">{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
    </HubShell>
  );
}

export function TrustPage() {
  return (
    <HubShell
      path="/trust"
      title="Trust & permissions — what Intake asks for | Intake"
      description="Intake asks for your identity to sign in, then the narrowest scope each provider allows — nothing else. No Gmail, Drive, or response access, for any provider, now or later."
      eyebrow="TRUST & PERMISSIONS"
      heading={<>Your forms, your account, your responses.</>}
      lede="Two permissions, each with a reason. Intake cannot read your responses, touch your Gmail or Drive, or move your data anywhere — by design, not by promise."
    >
      <section className="mk-section" aria-label="Permissions detail">
        <div className="mk-container mk-trust-page">
          <Reveal variant="fade">
            <h2>What Intake asks for</h2>
            <ul className="mk-trust__ask">
              <li><strong>Your basic identity, to sign you in</strong><p>Name, email address, and profile info (the openid, email, and profile scopes). This never touches your forms.</p></li>
              <li><strong>Google: forms.body, only when you connect</strong><p>One extra scope, requested in a separate step you start yourself: permission to create and edit the Google Forms you own. Nothing else.</p></li>
              <li><strong>Typeform: forms:write, forms:read, accounts:read, offline</strong><p>Create and list your Typeforms, read which account you connected, and stay connected past the one-week token. No responses, webhooks, workspaces, themes or images.</p></li>
            </ul>
          </Reveal>
          <Reveal variant="fade">
            <h2>What editing cannot change</h2>
            <p>Creating a form has few limits. Editing one you already own is narrower, because every change is made through the provider&rsquo;s own API — and where that API cannot do something safely, Intake refuses and tells you why rather than approximating.</p>
            {(['google', 'typeform'] as const).map(provider => {
              const entry = EDIT_LIMITS[provider];
              if (!entry) return null;
              return <div key={provider} className="mk-trust__limits">
                <h3>{provider === 'google' ? 'Google Forms' : 'Typeform'}</h3>
                <p>{entry.summary}</p>
                <ul>
                  {entry.limits.map(limit => <li key={limit.key}><strong>{limit.title}.</strong> {limit.detail}</li>)}
                </ul>
              </div>;
            })}
            <p className="mk-hub-updated">These are enforced in the editor itself: the same list appears in the workspace, above the conversation, before you ask for a change.</p>

            <h2>What happens when a provider is added</h2>
            <p>Each new provider gets its own connection, its own narrow scope list, and its own entry on this page before it appears as live anywhere on the site. A logo in the roadmap is not a connection: planned providers are labelled planned until the OAuth flow, the scope list, and the creation path actually work.</p>
            <h2>What happens to your data</h2>
            <p>Your description goes to the AI provider to produce the proposal; the proposal comes back to you for approval. Form responses go straight to the provider you connected and Intake never sees them. Intake shows no ads, sells no data, and sends only the emails your account activity requires — plus the welcome mail and the update list you explicitly join.</p>
            <p>The binding version is the <a href="/privacy">privacy policy</a>, written against Google&rsquo;s API Services User Data Policy and Typeform&rsquo;s developer terms, and the <a href="/terms">terms of service</a>.</p>
            <p className="mk-hub-updated">Updated October 2026.</p>
          </Reveal>
        </div>
      </section>
    </HubShell>
  );
}

export function ChangelogPage() {
  return (
    <HubShell
      path="/changelog"
      title="Changelog — what Intake shipped | Intake"
      description="Every Intake release: launch, welcome mail, traffic analytics, and what's next. New capabilities ship weekly."
      eyebrow="CHANGELOG"
      heading={<>What shipped, and what is next.</>}
      lede="New capabilities land every week. This page is the record — and the update list hears about each one first."
    >
      <section className="mk-section" aria-label="Releases">
        <div className="mk-container">
          <ol className="mk-changelog">
            {CHANGELOG.map(entry => (
              <Reveal as="li" key={entry.date + entry.title} variant="fade">
                <span className="mk-changelog__date">{entry.date}</span>
                <div><h2>{entry.title}</h2><p>{entry.body}</p></div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
    </HubShell>
  );
}
