import { useState } from 'react';
import { LogoMark } from '../../components/LogoMark';
import { usePublicSession } from '../../marketing/usePublicSession';
import { PRICING_FAQS } from '../../content/pricing';
import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../../lib/plans';

type BillingCadence = 'month' | 'year';

const FREE_FEATURES = [
  `${PLAN_CATALOG.free.dailyCredits} AI credits refreshed each day at 00:00 UTC`,
  'Create Google Forms from a description',
  'Review and revise a proposal before creating it',
  'Prepare supported edits to existing Google Forms',
  'Private Intake form library',
];

const PRO_FEATURES = [
  `${PLAN_CATALOG.pro.dailyCredits} daily AI credits, plus ${PLAN_CATALOG.pro.monthlyCredits} monthly credits`,
  'The same supported creation and edit workflows available on Free',
  'Daily credits are used before the monthly reserve',
  'Monthly credits reset each period and do not roll over',
];

export function PricingPage() {
  const authenticated = usePublicSession();
  const [cadence, setCadence] = useState<BillingCadence>(() =>
    new URLSearchParams(window.location.search).get('billing') === 'annual' ? 'year' : 'month',
  );
  const comparison = proPriceComparison();
  const amount = cadence === 'month' ? comparison.monthlyCents : comparison.annualCents;

  return <div className="pricing-page">
    <a className="skip-link" href="#pricing-main">Skip to pricing details</a>
    <header className="pricing-header">
      <a href="/" className="app-logo" aria-label="Intake home"><LogoMark size={28} /><span>intake</span></a>
      <nav aria-label="Pricing navigation"><a href="/#how-it-works">How it works</a>{!authenticated && <a href="/auth/sign-in">Sign in</a>}<a className="btn btn-accent btn-sm" href={authenticated ? '/app' : '/auth/sign-up'}>{authenticated ? 'Open Intake' : 'Start free'}</a></nav>
    </header>

    <main id="pricing-main" tabIndex={-1}>
      <section className="pricing-intro" aria-labelledby="pricing-title">
        <span className="eyebrow">CLEAR PLANS · SERVER-ENFORCED CREDITS</span>
        <h1 id="pricing-title">Simple plans.<br /><em>Clear limits.</em></h1>
        <p>Start with Free. Pro adds a monthly credit reserve; supported form tools and Google Forms provider limits are the same on both plans today.</p>
        <div className="pricing-cadence-wrap">
          <div className="pricing-cadence" role="group" aria-label="Choose how to display Pro pricing">
            <button type="button" aria-pressed={cadence === 'month'} className={cadence === 'month' ? 'selected' : ''} onClick={() => setCadence('month')}>Monthly</button>
            <button type="button" aria-pressed={cadence === 'year'} className={cadence === 'year' ? 'selected' : ''} onClick={() => setCadence('year')}>Annual</button>
          </div>
          <span className="pricing-savings" aria-live="polite">{cadence === 'year' ? `Save ${comparison.annualSavingsPercent}% · ${formatUsd(comparison.annualSavingsCents)} per year` : 'Switch to annual to compare'}</span>
        </div>
      </section>

      <section className="pricing-plans" aria-label="Intake plans">
        <article className="pricing-plan-card" aria-labelledby="free-plan-title">
          <div className="pricing-plan-top"><span className="info-index">01 / GET STARTED</span><span className="pricing-plan-tag">NO PAYMENT</span></div>
          <h2 id="free-plan-title">{PLAN_CATALOG.free.label}</h2>
          <p className="pricing-plan-description">For building and safely reviewing forms with Intake.</p>
          <p className="pricing-amount"><strong>$0</strong><span>no payment</span></p>
          <a className="btn btn-ghost pricing-plan-action" href={authenticated ? '/app' : '/auth/sign-up'}>{authenticated ? 'Open Intake' : 'Create a free account'} <span aria-hidden>→</span></a>
          <ul>{FREE_FEATURES.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>

        <article className="pricing-plan-card is-pro" aria-labelledby="pro-plan-title">
          <div className="pricing-plan-top"><span className="info-index">02 / MORE CREDITS</span><span className="pricing-plan-tag">PRO</span></div>
          <h2 id="pro-plan-title">{PLAN_CATALOG.pro.label}</h2>
          <p className="pricing-plan-description">A larger monthly credit reserve for continued AI-assisted work.</p>
          <p className="pricing-amount" aria-live="polite" aria-atomic="true"><strong>{formatUsd(amount)}</strong><span>/{cadence === 'month' ? 'month' : 'year'}</span></p>
          {cadence === 'year' && <p className="pricing-equivalent">Equivalent to {formatUsd(comparison.monthlyEquivalentCents)} per month, billed annually.</p>}
          {cadence === 'month'
            ? <p className="pricing-compare">{formatUsd(comparison.monthlyCents)} each month · {formatUsd(comparison.monthlyBilledAnnualTotalCents)} over 12 months</p>
            : <p className="pricing-compare">{formatUsd(comparison.annualCents)} for 12 months · {formatUsd(comparison.annualSavingsCents)} less than 12 monthly payments</p>}
          <button className="btn btn-accent pricing-plan-action" type="button" disabled aria-describedby="payment-status">Upgrade checkout is not available yet</button>
          <ul>{PRO_FEATURES.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>
      </section>

      <p className="pricing-payment-note" id="payment-status"><strong>Payment status:</strong> Intake does not process payments or let you change plans yet. The cadence switch changes the price display only; it does not start a subscription or collect payment.</p>

      <section className="pricing-what-to-know" aria-labelledby="pricing-limits-title">
        <div><span className="info-index">WHAT TO KNOW</span><h2 id="pricing-limits-title">Credits, limits &amp; processing</h2></div>
        <ul>
          <li><strong>Credits are server-controlled.</strong> Intake calculates each operation’s cost from the validated proposal and shows your current balance and reset times in the workspace.</li>
          <li><strong>Unused credits do not roll over.</strong> Daily credits refresh at 00:00 UTC. Pro monthly credits refresh at the reset shown in your account.</li>
          <li><strong>Same provider limits on both plans.</strong> Google and AI-provider rate limits still apply equally. Intake does not offer priority processing.</li>
          <li><strong>Review before apply.</strong> AI interpretation can propose a draft; creating or editing a Google Form still waits for your explicit confirmation.</li>
        </ul>
      </section>

      <section className="pricing-faq" id="faq" aria-labelledby="pricing-faq-title">
        <div className="pricing-faq-heading"><span className="info-index">COMMON QUESTIONS</span><h2 id="pricing-faq-title">Before you decide.</h2></div>
        <div className="pricing-faq-list">{PRICING_FAQS.map(({ question, answer }) => <details key={question}>
          <summary>{question}</summary><p>{answer}</p>
        </details>)}</div>
      </section>
    </main>

    <footer className="pricing-footer"><a href="/" className="app-logo"><LogoMark size={22} /><span>intake</span></a><span>Built for the forms you already use.</span><a href={authenticated ? '/app' : '/auth/sign-in'}>{authenticated ? 'Open your workspace' : 'Already have an account? Sign in'}</a></footer>
  </div>;
}
