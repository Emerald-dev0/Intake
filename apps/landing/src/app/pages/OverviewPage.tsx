import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectionSummary } from '../Connections';
import { billingStatusLabel, creditSummary, resetInterval } from '../../lib/credits';
import { formatUsd, PLAN_CATALOG } from '../../lib/plans';
import { useWorkspace } from '../hooks/useWorkspace';

export function OverviewPage() {
  const { user, providers, credits, reloadCredits } = useWorkspace();
  const [idea, setIdea] = useState('');
  const navigate = useNavigate();
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (idea.trim()) navigate('/app/forms', { state: { initialPrompt: idea.trim() } });
  }
  const proPrices = PLAN_CATALOG.pro.prices;
  return <>
    <div className="page-heading"><div className="eyebrow">01 / YOUR WORKSPACE</div>
      <p>Welcome, {user.name.split(' ')[0]}.</p><h1>What do you need<br />to <em>collect?</em></h1><div className="heading-description">Describe the form you want. Intake will propose questions and logic for you to review before anything is created in Google Forms.</div>
    </div>

    <section className="dashboard-credit-card" aria-labelledby="dashboard-credit-title">
      {credits.status === 'ready' ? <>
        <div className="dashboard-credit-top">
          <div><span className="info-index">YOUR PLAN · SERVER-REPORTED</span><h2 id="dashboard-credit-title">{PLAN_CATALOG[credits.credits.plan].label} <span>{credits.credits.plan === 'free' ? '· $0' : `· Billing ${billingStatusLabel(credits.credits.subscriptionStatus).toLowerCase()}`}</span></h2></div>
          <div className="dashboard-credit-total"><strong>{credits.credits.availableCredits}</strong><span>available now</span></div>
        </div>
        <p className="dashboard-credit-summary">{creditSummary(credits.credits)}</p>
        <div className="dashboard-credit-buckets">
          <div><span>DAILY</span><strong>{credits.credits.dailyRemaining} <small>/ {credits.credits.dailyLimit}</small></strong><small>resets {resetInterval(credits.credits.nextDailyReset)} · 00:00 UTC</small></div>
          <div><span>MONTHLY</span><strong>{credits.credits.monthlyLimit > 0 ? <>{credits.credits.monthlyRemaining} <small>/ {credits.credits.monthlyLimit}</small></> : 'Not included'}</strong><small>{credits.credits.monthlyLimit > 0 ? `resets ${resetInterval(credits.credits.nextMonthlyReset)} · no rollover` : 'Pro includes a monthly reserve'}</small></div>
        </div>
        {credits.credits.availableCredits === 0 && <p className="dashboard-credit-state" role="status">No credits are available right now. Nothing was created or changed. Daily credits renew {resetInterval(credits.credits.nextDailyReset)}.</p>}
        <div className="dashboard-credit-actions"><a href="/app/account">Manage account and credits <span aria-hidden>↗</span></a>{credits.credits.plan === 'free' && <a href="/pricing">Explore Pro · {proPrices ? `${formatUsd(proPrices.month)}/month or ${formatUsd(proPrices.year)}/year` : 'view pricing'} <span aria-hidden>↗</span></a>}</div>
      </> : <>
        <div className="dashboard-credit-top"><div><span className="info-index">YOUR PLAN &amp; CREDITS</span><h2 id="dashboard-credit-title">{credits.status === 'loading' ? 'Checking your balance…' : 'Balance unavailable'}</h2></div></div>
        <p className="dashboard-credit-state" role={credits.status === 'error' ? 'alert' : 'status'}>{credits.status === 'loading' ? 'Intake is reading your server-reported plan and credit balance.' : 'Intake could not verify your balance. This is not a zero-credit result, and no plan is assumed.'}</p>
        {credits.status === 'error' && <button className="btn btn-ghost btn-sm" type="button" onClick={reloadCredits}>Retry credit check</button>}
      </>}
    </section>

    <form className="prompt-card" onSubmit={start}><div className="prompt-top"><span><span className="rec" /> START A FORM</span><span>INTAKE / CREATE</span></div><label htmlFor="future-prompt">Start with an idea</label><textarea id="future-prompt" value={idea} onChange={event => setIdea(event.target.value)} maxLength={3000} required placeholder="e.g. A registration form for our conference, with name, email and transportation needs…" aria-describedby="prompt-note" /><div className="prompt-actions"><span id="prompt-note">You can refine it before it reaches Google. No JSON required.</span><button className="btn btn-accent" type="submit" disabled={!idea.trim()}>Review my form →</button></div></form>
    <div className="dashboard-grid">
      <section className="info-card"><span className="info-index">01 / CONNECT</span><div className="info-icon">◇</div><h2>Your tools, your forms.</h2><p>Google Forms authorization is separate from your Intake sign-in. A connection lets Intake work only after you confirm a reviewed proposal.</p><a href="/app/connections">{connectionSummary(providers.providers)} <span>↗</span></a></section>
      <section className="info-card"><span className="info-index">02 / CREATE</span><div className="info-icon orange">✳</div><h2>Just say what you need.</h2><p>Intake turns your description into a proposed form. Review the questions, revise naturally and choose when to create the real form in your Google account.</p><a href="/app/forms">Open form creation <span>↗</span></a></section>
      <section className="info-card"><span className="info-index">03 / LIBRARY</span><div className="info-icon">▤</div><h2>All your forms in one place.</h2><p>Find, inspect live status, open in Google Forms, or continue editing previously created or imported forms.</p><a href="/app/library">Open form library <span>↗</span></a></section>
    </div>
  </>;
}
