import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectionSummary } from '../Connections';
import { billingStatusLabel, creditSummary, resetInterval } from '../../lib/credits';
import { FORM_PROVIDERS, FORM_PROVIDER_LABELS, formProviderLabel, type FormProvider } from '../../lib/connections';
import { PAID_BILLING_ENABLED, PLAN_CATALOG } from '../../lib/plans';
import { useWorkspace } from '../hooks/useWorkspace';
import { useRecentForms } from '../hooks/useRecentForms';
import { ProviderMark } from '../components/ProviderBadge';

const STARTERS: { label: string; prompt: string }[] = [
  { label: 'Event registration', prompt: 'Create an event registration form with full name, email, phone number, ticket type, and dietary requirements.' },
  { label: 'Project feedback', prompt: 'Create a short feedback form for our project showcase with a rating, what worked well, and what we should improve.' },
  { label: 'Team sign-up', prompt: 'Create a form for people to join a waiting list: name, email, department, and whether they need accessibility support.' },
];

/**
 * The home surface. It is still a composer first: the thing a person came to do is type one
 * sentence, and nothing is allowed to push that below the fold. What sits above it now is a single
 * status strip — plan, credits with the reset in plain words, provider state, and the one action
 * that actually unblocks them — and what sits below is what they made.
 */
export function OverviewPage() {
  const { user, providers, credits, reloadCredits } = useWorkspace();
  const recent = useRecentForms();
  const [idea, setIdea] = useState('');
  const [provider, setProvider] = useState<FormProvider>('google');
  const navigate = useNavigate();

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (idea.trim()) navigate('/app/forms', { state: { initialPrompt: idea.trim(), provider } });
  }

  const firstName = user.name.trim().split(/\s+/)[0] || 'there';
  const ready = credits.status === 'ready' ? credits.credits : null;
  const outOfCredits = ready !== null && ready.availableCredits === 0;
  const connected = providers.providers?.filter(entry => entry.status === 'connected').length ?? 0;
  const suggested = recent.state.forms.slice(0, 4);
  const providerState = providers.status === 'ready' ? (connected > 0 ? 'ready' : 'none') : providers.status;
  // Exactly one next action, chosen from server state. Absent every problem, absent every nudge.
  /**
   * First-run progress, and only from things the server has told us.
   *
   * Every step maps to a fact Intake actually holds: a connected provider, a saved form record, and
   * at least one form that reached `created`. Nothing is marked done because a browser remembered a
   * click, and a step whose source could not be read is `unknown` rather than unticked — "we could
   * not check" is not the same claim as "you have not done this".
   */
  const steps: Array<{ label: string; detail: string; state: 'done' | 'todo' | 'unknown'; href: string }> = [
    {
      label: 'Connect a form provider',
      detail: 'Google Forms or Typeform — the account that will hold your forms.',
      state: providers.status === 'ready' ? (connected > 0 ? 'done' : 'todo') : providers.status === 'error' ? 'unknown' : 'todo',
      href: '/app/connections',
    },
    {
      label: 'Describe your first form',
      detail: 'One sentence in the box above. Intake drafts the questions.',
      state: recent.state.status === 'error' ? 'unknown' : recent.state.status === 'ready' && recent.state.forms.length > 0 ? 'done' : 'todo',
      href: '/app/forms',
    },
    {
      label: 'Approve one and create it',
      detail: 'Nothing is written to your account until you confirm.',
      state: recent.state.status === 'error' ? 'unknown' : recent.state.status === 'ready' && recent.state.forms.some(form => form.status === 'created') ? 'done' : 'todo',
      href: '/app/forms',
    },
  ];
  const stepsDone = steps.filter(step => step.state === 'done').length;
  const showFirstRun = recent.state.status !== 'loading' && stepsDone < steps.length;

  const nextAction = outOfCredits
    ? { label: 'See plans', href: '/pricing' }
    : providers.status === 'ready' && connected === 0
      ? { label: 'Connect a provider', href: '/app/connections' }
      : ready && ready.plan === 'free' && PAID_BILLING_ENABLED
        ? { label: 'Compare plans', href: '/pricing' }
        : null;

  return (
    <div className="home">
      <header className="home__greeting">
        <span className="eyebrow">Good to see you, {firstName}</span>
        <h1>What do you need<br /><em>to collect?</em></h1>
        <p>Describe the form in a sentence. Intake drafts the questions, you approve them, then it creates the real form in your own account.</p>
      </header>

      <form className="home__composer" onSubmit={start}>
        <label className="sr-only" htmlFor="future-prompt">Describe the form you need</label>
        <textarea
          id="future-prompt"
          value={idea}
          onChange={event => setIdea(event.target.value)}
          maxLength={3000}
          required
          placeholder="e.g. A registration form for our conference, with name, email and transportation needs…"
          aria-describedby="prompt-note"
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
        />
        <div className="home__composer-target" role="group" aria-label="Create the form in">
          <span>Create in</span>
          {FORM_PROVIDERS.map(option => {
            const connection = providers.providers?.find(entry => entry.id === option);
            const connectedOption = connection?.status === 'connected';
            return <button
              key={option}
              type="button"
              className={`target-chip ${option === provider ? 'selected' : ''}`}
              aria-pressed={option === provider}
              onClick={() => setProvider(option)}
              title={connectedOption ? `Connected${connection?.accountEmail ? ` as ${connection.accountEmail}` : ''}` : `${FORM_PROVIDER_LABELS[option]} is not connected yet`}
            >
              <ProviderMark provider={option} />
              {FORM_PROVIDER_LABELS[option]}
              {connection && !connectedOption && <span className="target-chip__dot" aria-label="Not connected" />}
            </button>;
          })}
        </div>
        <div className="home__composer-foot">
          <span id="prompt-note">Enter to start · nothing is created until you confirm</span>
          <button className="btn btn-accent" type="submit" disabled={!idea.trim() || outOfCredits}>Start →</button>
        </div>
      </form>

      <div className="home__status" aria-label="Your account at a glance">
        <a className="home__status-item" href="/app/billing">
          <span>Plan</span>
          <strong>{ready ? PLAN_CATALOG[ready.plan].label : credits.status === 'error' ? 'Unavailable' : '—'}</strong>
        </a>
        <div className="home__status-item">
          <span>Credits</span>
          {ready
            ? <><strong>{creditSummary(ready)}</strong><small>daily credits reset {resetInterval(ready.nextDailyReset)}</small></>
            : credits.status === 'error'
              ? <button type="button" className="link-button is-warn" onClick={reloadCredits}>Could not check — retry</button>
              : <strong>—</strong>}
        </div>
        <a className="home__status-item" href="/app/connections">
          <span>Providers</span>
          {providers.status === 'ready'
            ? <strong className={providerState === 'none' ? 'is-warn' : ''}>{providerState === 'none' ? 'None connected' : `${connected} connected`}</strong>
            : providers.status === 'error'
              ? <strong className="is-warn">Could not check</strong>
              : <strong>—</strong>}
        </a>
        <a className="home__status-item home__status-item--action" href={nextAction ? nextAction.href : '/app/library'}>
          <span>Next</span>
          <strong>{nextAction ? nextAction.label : 'Open your library'} →</strong>
        </a>
      </div>

      {showFirstRun && (
        <section className="home__first-run" aria-labelledby="first-run-title">
          <header>
            <h2 id="first-run-title">Getting started</h2>
            <span>{stepsDone} of {steps.length}</span>
          </header>
          <ol>
            {steps.map(step => (
              <li key={step.label} className={`is-${step.state}`}>
                <span className="home__step-mark" aria-hidden>{step.state === 'done' ? '✓' : step.state === 'unknown' ? '?' : ''}</span>
                <div>
                  <a href={step.href}>{step.label}</a>
                  <small>{step.state === 'unknown' ? `Could not check — ${step.detail.toLowerCase()}` : step.detail}</small>
                </div>
                <span className="sr-only">
                  {step.state === 'done' ? 'Done.' : step.state === 'unknown' ? 'Could not be checked.' : 'Not done yet.'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="home__starters" aria-label="Example forms">
        <span>Try</span>
        {STARTERS.map(starter => (
          <button key={starter.label} type="button" className="home__starter" onClick={() => setIdea(starter.prompt)}>{starter.label}</button>
        ))}
      </div>

      {outOfCredits && ready && <div className="form-banner warn home__banner" role="status">
        <p>No credits are available right now. Nothing was created or changed. Daily credits renew {resetInterval(ready.nextDailyReset)}.</p>
        <a className="btn btn-ghost btn-sm" href="/pricing">See plans →</a>
      </div>}

      <section className="home__section" aria-labelledby="home-recent-title">
        <div className="home__section-head">
          <h2 id="home-recent-title">Recent forms</h2>
          <a href="/app/library">Open library →</a>
        </div>
        {recent.state.status === 'loading' && <p className="fine-print" role="status">Loading your forms…</p>}
        {recent.state.status === 'error' && <div className="form-banner bad" role="alert">
          <p>Intake couldn’t load your recent forms. This does not mean they are gone.</p>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void recent.load()}>Try again</button>
        </div>}
        {recent.state.status === 'ready' && suggested.length === 0 && <p className="fine-print">Forms you create will show up here, with the links you need to share them.</p>}
        {suggested.length > 0 && <ul className="home__recent">
          {suggested.map(form => <li key={form.id}>
            <ProviderMark provider={form.provider} />
            <div>
              <strong>{form.title}</strong>
              <small>{formProviderLabel(form.provider)} · {form.status === 'incomplete' ? 'Incomplete' : 'Live'}</small>
            </div>
            {form.responderUrl && <a href={form.responderUrl} target="_blank" rel="noreferrer">Open ↗</a>}
          </li>)}
        </ul>}
      </section>

      <footer className="home__footnote">
        <div>
          {ready
            ? <><strong>{PLAN_CATALOG[ready.plan].label}</strong> · {creditSummary(ready)}{ready.subscriptionStatus !== 'none' && <> · Billing {billingStatusLabel(ready.subscriptionStatus).toLowerCase()}</>} <a href="/app/billing">Manage</a></>
            : credits.status === 'error'
              ? <button type="button" className="link-button" onClick={reloadCredits}>Credits unavailable — retry</button>
              : 'Checking your plan…'}
        </div>
        <div>
          <a href="/app/connections">{connectionSummary(providers.providers)}{connected === 0 ? ' — connect a provider' : ''} ↗</a>
          {ready?.plan === 'free' && <a href="/pricing">{PAID_BILLING_ENABLED ? 'Explore Pro' : 'Pro is coming soon'} ↗</a>}
        </div>
      </footer>
    </div>
  );
}
