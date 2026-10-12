import { useState, useEffect, useCallback } from 'react';
import { creditSummary, resetInterval } from '../../lib/credits';
import { CREDIT_PACK_CATALOG, PAID_BILLING_ENABLED, PLAN_CATALOG, formatUsd } from '../../lib/plans';
import { useCredits } from '../hooks/useCredits';
import { useWorkspace } from '../hooks/useWorkspace';

interface BillingSummary {
  plan: string;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  nextRenewalDate: string | null;
  cancelAtPeriodEnd: boolean;
}

interface BillingHistory {
  payments: Array<{
    id: string;
    amountCents: number;
    amountFormatted: string;
    currency: string;
    purpose: string;
    status: string;
    createdAt: string;
  }>;
  creditPurchases: Array<{
    id: string;
    pack: string;
    credits: number;
    amountCents: number;
    amountFormatted: string;
    currency: string;
    status: string;
    grantedAt: string | null;
    createdAt: string;
  }>;
}

function purposeLabel(purpose: string): string {
  switch (purpose) {
    case 'subscription': return 'Subscription';
    case 'subscription_renewal': return 'Renewal';
    case 'credit_pack': return 'Credit pack';
    default: return 'Payment';
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'succeeded': case 'granted': return 'ok';
    case 'pending': return 'warn';
    case 'failed': return 'error';
    default: return '';
  }
}

export function BillingPage() {
  useWorkspace();
  const creditState = useCredits();
  const credits = creditState.state.status === 'ready' ? creditState.state.credits : null;

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [history, setHistory] = useState<BillingHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Paid checkout is closed during free launch, so there is no checkout return to handle.
  // The query cleanup below keeps stale ?checkout= links from showing a dead state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') && !PAID_BILLING_ENABLED) {
      window.history.replaceState({}, '', '/app/billing');
    }
  }, []);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, historyRes] = await Promise.all([
        fetch('/api/billing/summary', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/billing/history', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (historyRes.ok) setHistory(await historyRes.json());
    } catch {
      setError('Billing information is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBilling(); }, [loadBilling]);

  async function cancelSubscription() {
    if (!window.confirm('Are you sure you want to cancel your Pro subscription? You will keep Pro access until the end of your current billing period.')) return;
    setCancelLoading(true);
    setError('');
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediate: false }),
      });
      if (res.ok) {
        setMessage('Your subscription will end at the current billing period. No further charges will be made.');
        void loadBilling();
      } else {
        const data = await res.json();
        setError(data.message || 'Cancellation failed.');
      }
    } catch {
      setError('Cancellation failed. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  }

  const isPro = summary?.subscriptionActive ?? credits?.plan === 'pro';
  const isCanceled = summary?.cancelAtPeriodEnd ?? false;

  return <>
    <div className="page-heading">
      <div className="eyebrow">07 / BILLING</div>
      <h1>Your <em>billing.</em></h1>
      <div className="heading-description">{PAID_BILLING_ENABLED
        ? 'Manage your subscription, view credits and billing history, and purchase credit packs.'
        : 'Your plan, credits and billing history. Paid plans open later — everyone builds on Free for now.'}</div>
    </div>

    {message && <div className="form-banner ok" role="status"><p>{message}</p><button className="btn-dismiss" onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
    {error && <div className="form-banner warn" role="alert"><p>{error}</p><button className="btn-dismiss" onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

    {/* Current Plan */}
    <section className="billing-section" aria-labelledby="current-plan-title">
      <div className="billing-section-header">
        <span className="info-index">CURRENT PLAN</span>
        <h2 id="current-plan-title">{isPro ? 'Pro' : 'Free'}</h2>
      </div>
      <div className="billing-plan-detail">
        {loading ? (
          <p className="forms-progress">Checking your plan…</p>
        ) : (
          <>
            <div className="billing-plan-info">
              <span className={`status-pill ${isPro ? 'ok' : ''}`}>
                {isPro ? (isCanceled ? 'Ending soon' : 'Active') : 'Free plan'}
              </span>
              {isPro && summary?.nextRenewalDate && (
                <p>{isCanceled
                  ? `Access ends ${new Date(summary.nextRenewalDate).toLocaleDateString()}`
                  : `Renews ${new Date(summary.nextRenewalDate).toLocaleDateString()}`
                }</p>
              )}
              {credits && (
                <p className="billing-credits-summary">{creditSummary(credits)}</p>
              )}
            </div>
            <div className="billing-plan-actions">
              {!PAID_BILLING_ENABLED && !isPro && (
                <p className="billing-coming-soon">You are on Free with {credits?.dailyLimit ?? PLAN_CATALOG.free.dailyCredits} daily credits. Pro and credit packs are coming soon.</p>
              )}
              {PAID_BILLING_ENABLED && !isPro && (
                <p className="billing-coming-soon">Paid checkout opens from the pricing page.</p>
              )}
              {isPro && !isCanceled && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={cancelLoading}
                  onClick={() => void cancelSubscription()}
                >
                  {cancelLoading ? 'Canceling…' : 'Cancel subscription'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>

    {/* Credits */}
    <section className="billing-section" aria-labelledby="credits-title">
      <div className="billing-section-header">
        <span className="info-index">CREDITS</span>
        <h2 id="credits-title">Your available credits</h2>
      </div>
      {credits ? (
        <div className="billing-credits-grid">
          <div className="billing-credit-card">
            <span>DAILY ALLOWANCE</span>
            <strong>{credits.dailyRemaining} <small>of {credits.dailyLimit}</small></strong>
            <p>Renews {resetInterval(credits.nextDailyReset)} at 00:00 UTC.</p>
          </div>
          {credits.monthlyLimit > 0 && (
            <div className="billing-credit-card">
              <span>SUBSCRIPTION CREDITS</span>
              <strong>{credits.monthlyRemaining} <small>of {credits.monthlyLimit}</small></strong>
              <p>Renews {resetInterval(credits.nextMonthlyReset)}.</p>
            </div>
          )}
          <div className="billing-credit-card">
            <span>TOTAL AVAILABLE</span>
            <strong>{credits.availableCredits}</strong>
            <p>Ready to use right now.</p>
          </div>
        </div>
      ) : (
        <p className="forms-progress">Checking credits…</p>
      )}
    </section>

    {/* Credit Packs */}
    <section className="billing-section" aria-labelledby="packs-title">
      <div className="billing-section-header">
        <span className="info-index">CREDIT PACKS{PAID_BILLING_ENABLED ? '' : ' · COMING SOON'}</span>
        <h2 id="packs-title">Buy credits when you need more</h2>
      </div>
      <p className="billing-section-description">{PAID_BILLING_ENABLED
        ? 'Purchased credits are used after your daily and subscription credits. They do not expire.'
        : 'Credit packs are not on sale yet. When they open, purchased credits are used after your daily and subscription credits and never expire.'}</p>
      <div className="billing-packs-grid">
        {CREDIT_PACK_CATALOG.map(pack => (
          <div key={pack.id} className="billing-pack-card">
            <h3>{pack.label}</h3>
            <p className="billing-pack-credits">{pack.credits} credits</p>
            <p className="billing-pack-price">{formatUsd(pack.priceCents)}</p>
            {!PAID_BILLING_ENABLED && <p className="billing-coming-soon">Coming soon</p>}
          </div>
        ))}
      </div>
    </section>

    {/* Billing History */}
    <section className="billing-section" aria-labelledby="history-title">
      <div className="billing-section-header">
        <span className="info-index">HISTORY</span>
        <h2 id="history-title">Billing history</h2>
      </div>
      {loading ? (
        <p className="forms-progress">Loading history…</p>
      ) : history && (history.payments.length > 0 || history.creditPurchases.length > 0) ? (
        <div className="billing-history-list">
          {history.payments.map(payment => (
            <div key={payment.id} className="billing-history-item">
              <div className="billing-history-main">
                <span className={`status-pill ${statusBadge(payment.status)}`}>{payment.status}</span>
                <span>{purposeLabel(payment.purpose)}</span>
                <strong>{payment.amountFormatted}</strong>
              </div>
              <span className="billing-history-date">{new Date(payment.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
          {history.creditPurchases.map(purchase => (
            <div key={purchase.id} className="billing-history-item">
              <div className="billing-history-main">
                <span className={`status-pill ${statusBadge(purchase.status)}`}>{purchase.status}</span>
                <span>Credit pack: {purchase.credits} credits</span>
                <strong>{purchase.amountFormatted}</strong>
              </div>
              <span className="billing-history-date">{new Date(purchase.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="billing-empty">No billing history yet. Your payments and credit purchases will appear here.</p>
      )}
    </section>
  </>;
}
