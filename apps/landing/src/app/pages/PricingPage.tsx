import { useState } from 'react';
import { LogoMark } from '../../components/LogoMark';
import { usePublicSession } from '../../marketing/usePublicSession';
import { pricingFaqEntries } from '../../content/pricing';
import { PLAN_CATALOG, formatUsd } from '../../lib/plans';
import { comparePlanPrices, useBillingPlans } from '../../lib/useBillingPlans';
import { useSiteAnalytics } from '../../lib/analytics';

type BillingCadence = 'month' | 'year';

export function PricingPage() {
  const authenticated = usePublicSession();
  useSiteAnalytics('/pricing');
  const plans = useBillingPlans();
  const [cadence, setCadence] = useState<BillingCadence>(() =>
    new URLSearchParams(window.location.search).get('billing') === 'annual' ? 'year' : 'month',
  );
  // Amounts and allowances come from the server (admin dashboard overrides
  // included) and fall back to the build-time catalogue while loading.
  const comparison = comparePlanPrices(plans.proMonthlyCents, plans.proAnnualCents);
  const amount = cadence === 'month' ? comparison.monthlyCents : comparison.annualCents;
  const freeFeatures = [
    `${plans.freeDailyCredits} credits refreshed each day at 00:00 UTC`,
    'Create Google Forms from a description',
    'Check and change every question before it is created',
    'Make changes to forms you already have',
    'A private library of everything you make',
  ];
  const proFeatures = [
    `${plans.proDailyCredits} daily credits, plus ${plans.proMonthlyCredits} monthly credits`,
    'Everything on Free, unchanged',
    'Daily credits are used first, then the monthly reserve',
    'Monthly credits refresh each period and do not roll over',
  ];
  const faqs = pricingFaqEntries({
    freeDailyCredits: plans.freeDailyCredits,
    proDailyCredits: plans.proDailyCredits,
    proMonthlyCredits: plans.proMonthlyCredits,
    monthlyCents: comparison.monthlyCents,
    annualCents: comparison.annualCents,
  });

  return <div className="pricing-page">
    <a className="skip-link" href="#pricing-main">Skip to pricing details</a>
    <header className="pricing-header">
      <a href="/" className="app-logo" aria-label="Intake home"><LogoMark size={28} /><span>intake</span></a>
      <nav aria-label="Pricing navigation"><a href="/#how-it-works">How it works</a>{!authenticated && <a href="/auth/sign-in">Sign in</a>}<a className="btn btn-accent btn-sm" href={authenticated ? '/app' : '/auth/sign-up'}>{authenticated ? 'Open Intake' : 'Start free'}</a></nav>
    </header>

    <main id="pricing-main" tabIndex={-1}>
      <section className="pricing-intro" aria-labelledby="pricing-title">
        <span className="eyebrow">FREE DURING LAUNCH · PRO COMING SOON</span>
        <h1 id="pricing-title">Free while we launch.<br /><em>Pro comes next.</em></h1>
        <p>Everyone gets {plans.freeDailyCredits} credits a day, refreshed at 00:00 UTC. Sign up free and build — Pro and credit packs open later, and everything you make comes with you.</p>
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
          <ul>{freeFeatures.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>

        <article className="pricing-plan-card is-pro" aria-labelledby="pro-plan-title">
          <div className="pricing-plan-top"><span className="info-index">02 / MORE CREDITS</span><span className="pricing-plan-tag">COMING SOON</span></div>
          <h2 id="pro-plan-title">{PLAN_CATALOG.pro.label}</h2>
          <p className="pricing-plan-description">A larger monthly credit reserve for the months when you build a lot. Not on sale yet — the prices below are what Pro will cost when it opens.</p>
          {plans.paidBillingEnabled ? (
            <>
              <p className="pricing-amount" aria-live="polite" aria-atomic="true"><strong>{formatUsd(amount)}</strong><span>/{cadence === 'month' ? 'month' : 'year'}</span></p>
              {cadence === 'year' && <p className="pricing-equivalent">Equivalent to {formatUsd(comparison.monthlyEquivalentCents)} per month, billed annually.</p>}
              {cadence === 'month'
                ? <p className="pricing-compare">{formatUsd(comparison.monthlyCents)} each month · {formatUsd(comparison.monthlyBilledAnnualTotalCents)} over 12 months</p>
                : <p className="pricing-compare">{formatUsd(comparison.annualCents)} for 12 months · {formatUsd(comparison.annualSavingsCents)} less than 12 monthly payments</p>}
            </>
          ) : (
            <p className="pricing-amount" aria-live="polite" aria-atomic="true"><strong>Coming soon</strong><span> · {formatUsd(amount)}/{cadence === 'month' ? 'month' : 'year'} at launch</span></p>
          )}
          <a className="btn btn-accent pricing-plan-action" href={authenticated ? '/app' : '/auth/sign-up?plan=pro'}>{authenticated ? 'Open Intake' : 'Notify me when Pro opens'} <span aria-hidden>→</span></a>
          <ul>{proFeatures.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>
      </section>

      {/* Credit Packs */}
      <section className="pricing-credit-packs" aria-labelledby="packs-title">
        <div><span className="info-index">NEED MORE? · COMING SOON</span><h2 id="packs-title">Credit packs</h2></div>
        <p className="pricing-section-note">Credit packs are not on sale yet. Sign up free and build with your daily credits — packs open later.</p>
        <div className="pricing-packs-grid">
          {plans.packs.map(pack => (
            <article key={pack.id} className="pricing-pack-card" aria-labelledby={`pack-${pack.id}`}>
              <h3 id={`pack-${pack.id}`}>{pack.label}</h3>
              <p className="pricing-pack-credits">{pack.credits} credits</p>
              <p className="pricing-pack-price">{formatUsd(pack.priceCents)}</p>
              <p className="pricing-pack-note">Purchased credits never expire.</p>
              <a className="btn btn-ghost btn-sm" href={authenticated ? '/app' : '/auth/sign-up'}>
                {authenticated ? 'Coming soon' : 'Sign up free'}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="pricing-what-to-know" aria-labelledby="pricing-limits-title">
        <div><span className="info-index">WHAT TO KNOW</span><h2 id="pricing-limits-title">Credits, limits &amp; processing</h2></div>
        <ul>
          <li><strong>You see the cost first.</strong> Intake works out what a request costs before anything is applied, and your balance and reset times are always visible in the workspace.</li>
          <li><strong>Unused credits do not roll over.</strong> Daily credits refresh at 00:00 UTC. When Pro opens, its monthly credits refresh at the reset shown in your account.</li>
          <li><strong>Credit packs are coming soon.</strong> When they open, purchased credits never expire and are used after daily and subscription credits.</li>
          <li><strong>Same limits on both plans.</strong> Google's own limits apply the same way on Free and Pro.</li>
          <li><strong>Review before apply.</strong> Intake can propose a draft; creating or editing a Google Form still waits for your explicit confirmation.</li>
        </ul>
      </section>

      <section className="pricing-faq" id="faq" aria-labelledby="pricing-faq-title">
        <div className="pricing-faq-heading"><span className="info-index">COMMON QUESTIONS</span><h2 id="pricing-faq-title">Before you decide.</h2></div>
        <div className="pricing-faq-list">{faqs.map(({ question, answer }) => <details key={question}>
          <summary>{question}</summary><p>{answer}</p>
        </details>)}</div>
      </section>
    </main>

    <footer className="pricing-footer"><a href="/" className="app-logo"><LogoMark size={22} /><span>intake</span></a><span>Built for the forms you already use.</span><a href={authenticated ? '/app' : '/auth/sign-in'}>{authenticated ? 'Open your workspace' : 'Already have an account? Sign in'}</a></footer>
  </div>;
}
