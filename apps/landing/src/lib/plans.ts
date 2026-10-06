/**
 * Public plan and price metadata shared by the product UI and server entitlement projection.
 *
 * This is descriptive only: the server still owns account plans, grants, balances, and charges.
 * The authoritative billing configuration lives in `server/billing/plans.ts`.
 *
 * Phase 18 update: pricing now reflects the production billing model.
 *   Free:  $0 — 10 credits/day
 *   Pro:   $7.99/month or $69/year — 1,000 subscription credits per billing period + 10 daily
 *   Annual saves $26.89 vs 12 monthly payments (28.0%)
 *
 * Credit packs (purchased, distinguishable from subscription):
 *   Starter:  100 credits — $1.99
 *   Standard: 500 credits — $5.99
 *   Power:  1,500 credits — $12.99
 */

export const PLAN_IDS = ['free', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type ProBillingInterval = 'month' | 'year';

export interface PlanCatalogEntry {
  id: PlanId;
  label: string;
  dailyCredits: number;
  monthlyCredits: number;
  /** Null means the plan has no paid billing cadence. Prices are display metadata only. */
  prices: { month: number; year: number } | null;
}

export const PLAN_CATALOG: Record<PlanId, PlanCatalogEntry> = {
  free: {
    id: 'free',
    label: 'Free',
    dailyCredits: 10,
    monthlyCredits: 0,
    prices: null,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    dailyCredits: 10,
    monthlyCredits: 1000,
    prices: { month: 799, year: 6900 },
  },
};

/** Credit-pack catalogue for display. Amounts are in cents. */
export interface CreditPackCatalogEntry {
  id: string;
  label: string;
  credits: number;
  priceCents: number;
}

export const CREDIT_PACK_CATALOG: CreditPackCatalogEntry[] = [
  { id: 'starter', label: 'Starter', credits: 100, priceCents: 199 },
  { id: 'standard', label: 'Standard', credits: 500, priceCents: 599 },
  { id: 'power', label: 'Power', credits: 1500, priceCents: 1299 },
];

export interface ProPriceComparison {
  monthlyCents: number;
  annualCents: number;
  monthlyEquivalentCents: number;
  monthlyBilledAnnualTotalCents: number;
  annualSavingsCents: number;
  annualSavingsPercent: number;
}

export function proPriceComparison(): ProPriceComparison {
  const prices = PLAN_CATALOG.pro.prices!;
  const monthlyBilledAnnualTotalCents = prices.month * 12;
  const annualSavingsCents = Math.max(0, monthlyBilledAnnualTotalCents - prices.year);
  return {
    monthlyCents: prices.month,
    annualCents: prices.year,
    monthlyEquivalentCents: Math.round(prices.year / 12),
    monthlyBilledAnnualTotalCents,
    annualSavingsCents,
    annualSavingsPercent: monthlyBilledAnnualTotalCents === 0
      ? 0
      : Math.round((annualSavingsCents / monthlyBilledAnnualTotalCents) * 1000) / 10,
  };
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}
