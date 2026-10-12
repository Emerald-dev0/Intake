import { useEffect, useState } from 'react';
import { CREDIT_PACK_CATALOG, PAID_BILLING_ENABLED, PLAN_CATALOG, type ProPriceComparison } from './plans';

/**
 * Runtime plan display values, honouring admin dashboard overrides.
 *
 * The server's `GET /api/billing/plans` reports the effective allowances and
 * prices (admin `billing_settings` row when saved, code defaults otherwise).
 * This hook fetches them once and falls back to the build-time catalogue when
 * the request fails — the page never blocks on pricing, and it never invents
 * numbers. Anything that must stay correct without a rebuild (plan cards,
 * amounts, daily lines) reads this hook; static SEO fallbacks keep the
 * catalogue values.
 */

export interface BillingPlanDisplay {
  paidBillingEnabled: boolean;
  freeDailyCredits: number;
  proDailyCredits: number;
  proMonthlyCredits: number;
  proMonthlyCents: number;
  proAnnualCents: number;
  packs: { id: string; label: string; credits: number; priceCents: number }[];
  /** True once server values arrived; false while showing build-time fallback. */
  live: boolean;
}

function intInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export function billingPlanDisplayFallback(): BillingPlanDisplay {
  return {
    paidBillingEnabled: PAID_BILLING_ENABLED,
    freeDailyCredits: PLAN_CATALOG.free.dailyCredits,
    proDailyCredits: PLAN_CATALOG.pro.dailyCredits,
    proMonthlyCredits: PLAN_CATALOG.pro.monthlyCredits,
    proMonthlyCents: PLAN_CATALOG.pro.prices?.month ?? 0,
    proAnnualCents: PLAN_CATALOG.pro.prices?.year ?? 0,
    packs: CREDIT_PACK_CATALOG.map(pack => ({ ...pack })),
    live: false,
  };
}

function parsePlansPayload(payload: unknown): BillingPlanDisplay | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  const plans = Array.isArray(body.plans) ? body.plans as Record<string, unknown>[] : [];
  const packs = Array.isArray(body.creditPacks) ? body.creditPacks as Record<string, unknown>[] : [];
  const find = (id: string) => plans.find(plan => plan.id === id);
  const free = find('free');
  const monthly = find('pro_monthly');
  const annual = find('pro_annual');
  const freeDaily = intInRange(free?.dailyCredits, 1, 500);
  const proDaily = intInRange(monthly?.dailyCredits, 1, 500);
  const monthlyCents = intInRange(monthly?.priceCents, 0, 99900);
  const annualCents = intInRange(annual?.priceCents, 0, 99900);
  if (freeDaily === null || proDaily === null || monthlyCents === null || annualCents === null) return null;
  const fallback = billingPlanDisplayFallback();
  return {
    paidBillingEnabled: typeof body.paidBillingEnabled === 'boolean' ? body.paidBillingEnabled : fallback.paidBillingEnabled,
    freeDailyCredits: freeDaily,
    proDailyCredits: proDaily,
    proMonthlyCredits: fallback.proMonthlyCredits,
    proMonthlyCents: monthlyCents,
    proAnnualCents: annualCents,
    packs: packs.length > 0
      ? packs.flatMap(pack => {
        const priceCents = intInRange(pack.priceCents, 0, 99900);
        const credits = intInRange(pack.credits, 1, 100000);
        if (priceCents === null || credits === null || typeof pack.id !== 'string' || typeof pack.label !== 'string') return [];
        return [{ id: pack.id, label: pack.label, credits, priceCents }];
      })
      : fallback.packs,
    live: true,
  };
}

/** Same comparison maths as `proPriceComparison`, over runtime cents. */
export function comparePlanPrices(monthlyCents: number, annualCents: number): ProPriceComparison {
  const monthlyBilledAnnualTotalCents = monthlyCents * 12;
  const annualSavingsCents = Math.max(0, monthlyBilledAnnualTotalCents - annualCents);
  return {
    monthlyCents,
    annualCents,
    monthlyEquivalentCents: Math.round(annualCents / 12),
    monthlyBilledAnnualTotalCents,
    annualSavingsCents,
    annualSavingsPercent: monthlyBilledAnnualTotalCents === 0
      ? 0
      : Math.round((annualSavingsCents / monthlyBilledAnnualTotalCents) * 1000) / 10,
  };
}

export function useBillingPlans(): BillingPlanDisplay {
  const [display, setDisplay] = useState<BillingPlanDisplay>(billingPlanDisplayFallback);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/billing/plans', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (!active || !response.ok) return;
        const parsed = parsePlansPayload(payload);
        if (parsed) setDisplay(parsed);
      } catch {
        // Fallback display stays: pricing must never block the page.
      }
    })();
    return () => { active = false; };
  }, []);
  return display;
}
