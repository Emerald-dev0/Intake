import { useState } from 'react';
import { authClient as client } from '../../lib/auth';
import { billingStatusLabel, creditSummary, resetInterval } from '../../lib/credits';
import { PLAN_CATALOG, formatUsd } from '../../lib/plans';
import { oauthErrorMessage } from '../../lib/sign-in-errors';
import { connectionSummary } from '../Connections';
import { useCredits } from '../hooks/useCredits';
import { useSession } from '../hooks/useSession';
import { useSignInConfig } from '../hooks/useSignInConfig';
import { useWorkspace } from '../hooks/useWorkspace';

function nearDailyLimit(remaining: number, limit: number): boolean {
  return limit > 0 && remaining > 0 && remaining <= Math.max(1, Math.ceil(limit * 0.2));
}

export function AccountPage() {
  const { user, providers, credits: balanceState } = useWorkspace();
  const { authenticationMethods } = useSession();
  const creditControls = useCredits();
  const google = useSignInConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linkError = new URLSearchParams(location.search).get('error');
  const params = new URLSearchParams(location.search);
  const googleLinked = authenticationMethods?.methods.includes('google') ?? false;
  const emailPasswordLinked = authenticationMethods?.methods.includes('email_password') ?? false;
  const credits = balanceState.status === 'ready' ? balanceState.credits : null;
  const proPrice = PLAN_CATALOG.pro.prices;

  async function linkGoogle() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      // Explicit, user-initiated linking. Intake never merges a password account into a Google
      // sign-in silently; this is the deliberate action the user takes instead.
      await client.linkSocial({ provider: 'google', callbackURL: '/app/account', errorCallbackURL: '/app/account' });
    } catch {
      setError('Unable to reach Intake right now. Please try again.');
      setBusy(false);
    }
  }

  return <>
    <div className="page-heading"><div className="eyebrow">06 / PROFILE</div><h1>Your <em>account.</em></h1><div className="heading-description">Manage your Intake identity, see your current server-reported plan and understand the AI credits available to you.</div></div>

    <div className="account-overview-grid">
      <section className="profile-card account-profile" aria-label="Intake account identity">
        <div className="avatar large">{user.name.slice(0, 1).toUpperCase()}</div>
        <div><span>INTAKE ACCOUNT</span><strong>{user.name}</strong><span>EMAIL</span><strong>{user.email}</strong></div>
      </section>

      <section className="account-plan-card" aria-labelledby="plan-title">
        <div className="account-card-heading"><span className="info-index">YOUR PLAN</span>{credits && <span className="status-pill ok">{PLAN_CATALOG[credits.plan].label.toUpperCase()}</span>}</div>
        <h2 id="plan-title">{credits ? PLAN_CATALOG[credits.plan].label : balanceState.status === 'loading' ? 'Checking plan…' : 'Plan unavailable'}</h2>
        {credits?.plan === 'free' && <>
          <p className="account-plan-summary">Free · $0, with {credits.dailyLimit} AI credits renewed every day. There is no monthly Pro reserve on this plan.</p>
          <a className="btn btn-ghost btn-sm" href="/pricing">Compare Free and Pro <span aria-hidden>↗</span></a>
        </>}
        {credits?.plan === 'pro' && <>
          <p className="account-plan-summary">Pro includes {credits.dailyLimit} daily credits and a {credits.monthlyLimit}-credit monthly reserve. Unused credits do not roll over.</p>
          <p className="account-billing-status"><span>Billing status on record</span><strong>{billingStatusLabel(credits.subscriptionStatus)}</strong></p>
          {credits.subscriptionStatus === 'none' && <p className="account-disclaimer">Pro access is enabled for this account, but Intake has no connected billing record. Payments and self-service plan changes are not available.</p>}
          {proPrice && <p className="account-price-reference">Published Pro pricing: {formatUsd(proPrice.month)} monthly or {formatUsd(proPrice.year)} yearly.</p>}
          <a className="btn btn-ghost btn-sm" href="/pricing?billing=annual">View Pro plan details <span aria-hidden>↗</span></a>
        </>}
        {!credits && <p className="account-plan-summary">Intake could not confirm your current plan. Retry the credit check; no plan or credit amount is assumed.</p>}
      </section>
    </div>

    <section className="account-credit-panel" aria-labelledby="account-credits-title">
      <div className="account-credit-heading"><div><span className="info-index">AI CREDIT BALANCE</span><h2 id="account-credits-title">What you can use right now</h2></div>
        {credits && <div className="account-available"><strong>{credits.availableCredits}</strong><span>available now</span></div>}
      </div>
      {credits ? <>
        <p className="account-credit-summary" aria-live="polite">{creditSummary(credits)}</p>
        {credits.availableCredits === 0 && <div className="form-banner warn account-credit-alert" role="status">
          <strong>No AI credits are available right now.</strong>
          <p>Nothing can be created or changed until the next reset. Daily credits reset {resetInterval(credits.nextDailyReset)} (00:00 UTC).</p>
          {credits.plan === 'free' && <a href="/pricing">See the Pro monthly-reserve details →</a>}
        </div>}
        {nearDailyLimit(credits.dailyRemaining, credits.dailyLimit) && <p className="account-limit-note" role="status">You are close to today’s daily limit. {credits.plan === 'pro' && credits.monthlyRemaining > 0 ? 'Your monthly reserve remains available after the daily allowance is used.' : `Daily credits reset ${resetInterval(credits.nextDailyReset)}.`}</p>}
        <div className="account-credit-buckets">
          <div className="account-credit-bucket"><span>DAILY ALLOWANCE</span><strong>{credits.dailyRemaining} <small>of {credits.dailyLimit}</small></strong><p>Renews {resetInterval(credits.nextDailyReset)} at 00:00 UTC.</p></div>
          <div className="account-credit-bucket"><span>MONTHLY RESERVE</span><strong>{credits.monthlyLimit > 0 ? <>{credits.monthlyRemaining} <small>of {credits.monthlyLimit}</small></> : 'Not included'}</strong><p>{credits.monthlyLimit > 0 ? `Resets ${resetInterval(credits.nextMonthlyReset)}. Unused monthly credits do not roll over.` : 'Available with Pro; no monthly credits are included on Free.'}</p></div>
        </div>
        {balanceState.costGuide && <p className="account-cost-note">Typical AI work: a standard new form is {balanceState.costGuide.formCreate.standard} credits; one supported edit is {balanceState.costGuide.formEdit.singleChange} credit. Complex work costs more. Intake shows an estimate before interpretation and the exact charge after a usable proposal is ready.</p>}
      </> : <div className="account-credit-unavailable" role={balanceState.status === 'error' ? 'alert' : 'status'}>
        <p>{balanceState.status === 'loading' ? 'Checking your server-reported balance…' : 'Credits are temporarily unavailable. This is not a zero balance.'}</p>
        {balanceState.status === 'error' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => creditControls.reload()}>Retry credit check</button>}
      </div>}
    </section>

    <section className="account-credit-rules" aria-labelledby="credit-rules-title">
      <span className="info-index">CREDIT BASICS</span><h2 id="credit-rules-title">How credits work</h2>
      <ul>
        <li>The server calculates each charge from the validated proposal; the model and browser cannot choose a price.</li>
        <li>A successful interpretation is charged once. A clarification, unsupported result or failed operation uses no credits.</li>
        <li>Google Forms is contacted only after you review and explicitly confirm a proposal. Applying a reviewed proposal costs no additional AI credits.</li>
        <li>Daily credits refresh at 00:00 UTC. Monthly credits follow the reset time shown above; neither bucket rolls over.</li>
      </ul>
      <p>Prices on the public page are display information only. Payments and plan changes are not implemented.</p>
    </section>

    <section className="account-connections" aria-labelledby="signin-methods-title">
      <span className="info-index">SIGN-IN METHODS</span><h2 id="signin-methods-title">Signing in to Intake</h2>
      <p>Email/password and Google sign-in are ways to authenticate to Intake. Google sign-in is identity-only; it does not connect Google Forms or grant Intake access to your forms.</p>
      {!authenticationMethods || !authenticationMethods.available
        ? <p className="forms-progress" role="status">Intake could not check which sign-in methods are linked to this account.</p>
        : <div className="account-auth-methods">
          <div><span>Email &amp; password</span><span className={`status-pill ${emailPasswordLinked ? 'ok' : ''}`}>{emailPasswordLinked ? 'Connected' : 'Not linked'}</span></div>
          <div><span>Google sign-in</span><span className={`status-pill ${googleLinked ? 'ok' : google.status === 'available' ? 'warn' : ''}`}>{googleLinked ? 'Connected' : google.status === 'available' ? 'Available' : google.status === 'loading' ? 'Checking' : 'Not configured'}</span></div>
        </div>}
      {linkError && <p className="form-error" role="alert">{oauthErrorMessage(linkError)}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {authenticationMethods?.available && !googleLinked && google.status === 'available' && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void linkGoogle()}>{busy ? 'Opening Google…' : 'Link Google sign-in →'}</button>}
      {googleLinked && <p className="forms-progress">Google sign-in is linked. This does not change your Google Forms connection.</p>}
      {google.status === 'unavailable' && google.reason === 'not_configured' && <p className="forms-progress">Google sign-in is not configured on this Intake server.</p>}
      {params.get('error') === 'account_already_linked_to_different_user' && <p className="forms-progress">Use the Google account that matches {user.email}, or keep using your existing sign-in method.</p>}
    </section>

    <section className="account-connections account-provider-separation" aria-labelledby="forms-connection-title">
      <span className="info-index">GOOGLE FORMS AUTHORIZATION</span><h2 id="forms-connection-title">Connecting your forms account</h2>
      <p>This is a separate permission from Google sign-in. Authorize the Google account that can create and edit your forms; Intake uses it only for the form workflows you explicitly confirm.</p>
      <p>{providers.status === 'loading' ? 'Checking provider connections…' : providers.status === 'error' ? 'Provider connections could not be loaded. This does not affect your Intake sign-in.' : `${connectionSummary(providers.providers)}.`}</p>
      <a href="/app/connections">Manage Google Forms connection <span aria-hidden>↗</span></a>
    </section>
  </>;
}
