import { useState } from 'react';
import { LogoMark } from '../../components/LogoMark';
import { usePublicSession } from '../../marketing/usePublicSession';
import { PRICING_FAQS } from '../../content/pricing';
import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../../lib/plans';

type BillingCadence = 'month' | 'year';

const FREE_FEATURES = [
  `${PLAN_CATALOG.free.dailyCredits} credits refreshed each day at 00:00 UTC`,
  'Create Google Forms from a description',
  'Check and change every question before it is created',
  'Make changes to forms you already have',
  'A private library of everything you make',
];

const PRO_FEATURES = [
  `${PLAN_CATALOG.pro.dailyCredits} daily credits, plus ${PLAN_CATALOG.pro.monthlyCredits} monthly credits`,
  'Everything on Free, unchanged',
  'Daily credits are used first, then the monthly reserve',
  'Monthly credits refresh each period and do not roll over',
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
        <span className="eyebrow">CLEAR PLANS · NO SURPRISES</span>
        <h1 id="pricing-title">Simple plans.<br /><em>Clear limits.</em></h1>
        <p>Start with Free. Pro adds a monthly reserve of credits for the months when you need more. Everything else works the same on both plans.</p>
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
          <div className="pricing-plan-top"><span className="info-index">01 / GET STARTED</span><span className="pricing-plan-tag">FREE FOREVER</span></div>
          <h2 id="free-plan-title">{PLAN_CATALOG.free.label}</h2>
          <p className="pricing-plan-description">Everything you need to build forms from a sentence.</p>
          <p className="pricing-amount"><strong>$0</strong><span>forever</span></p>
          <a className="btn btn-ghost pricing-plan-action" href={authenticated ? '/app' : '/auth/sign-up'}>{authenticated ? 'Open Intake' : 'Create a free account'} <span aria-hidden>→</span></a>
          <ul>{FREE_FEATURES.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>

        <article className="pricing-plan-card is-pro" aria-labelledby="pro-plan-title">
          <div className="pricing-plan-top"><span className="info-index">02 / MORE CREDITS</span><span className="pricing-plan-tag">PRO</span></div>
          <h2 id="pro-plan-title">{PLAN_CATALOG.pro.label}</h2>
          <p className="pricing-plan-description">A larger monthly credit reserve for the months when you build a lot.</p>
          <p className="pricing-amount" aria-live="polite" aria-atomic="true"><strong>{formatUsd(amount)}</strong><span>/{cadence === 'month' ? 'month' : 'year'}</span></p>
          {cadence === 'year' && <p className="pricing-equivalent">Equivalent to {formatUsd(comparison.monthlyEquivalentCents)} per month, billed annually.</p>}
          {cadence === 'month'
            ? <p className="pricing-compare">{formatUsd(comparison.monthlyCents)} each month · {formatUsd(comparison.monthlyBilledAnnualTotalCents)} over 12 months</p>
            : <p className="pricing-compare">{formatUsd(comparison.annualCents)} for 12 months · {formatUsd(comparison.annualSavingsCents)} less than 12 monthly payments</p>}
          <a className="btn btn-accent pricing-plan-action" href={authenticated ? '/app' : '/auth/sign-up?plan=pro'}>{authenticated ? 'Open Intake' : 'Notify me when Pro opens'} <span aria-hidden>→</span></a>
          <ul>{PRO_FEATURES.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>
      </section>

      <section className="pricing-what-to-know" aria-labelledby="pricing-limits-title">
        <div><span className="info-index">WHAT TO KNOW</span><h2 id="pricing-limits-title">Credits, limits &amp; processing</h2></div>
        <ul>
          <li><strong>You see the cost first.</strong> Intake works out what a request costs before anything is applied, and your balance and reset times are always visible in the workspace.</li>
          <li><strong>Unused credits do not roll over.</strong> Daily credits refresh at 00:00 UTC. Pro monthly credits refresh at the reset shown in your account.</li>
          <li><strong>Same limits on both plans.</strong> Google’s own limits apply the same way on Free and Pro.</li>
          <li><strong>Review before apply.</strong> Intake can propose a draft; creating or editing a Google Form still waits for your explicit confirmation.</li>
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
