/**
 * Canonical billing plan and credit-pack configuration.
 *
 * The backend is authoritative. The frontend may consume public-safe metadata from
 * `src/lib/plans.ts` for display, but checkout amounts, credit allowances and entitlement
 * decisions always come from this module.
 *
 * Money is represented as integer minor units (cents) everywhere. No floating-point arithmetic
 * is used for financial amounts.
 *
 * The annual Pro plan is modelled as a 12-period subscription where each period grants 1,000
 * subscription credits. This keeps the credit model consistent rather than creating a special
 * annual bucket.
 */

export const BILLING_CURRENCY = 'USD' as const;
export type BillingCurrency = typeof BILLING_CURRENCY;

// ── Plans ──────────────────────────────────────────────────────────────────────────────────────

export const PLAN_IDS = ['free', 'pro_monthly', 'pro_annual'] as const;
export type BillingPlanId = (typeof PLAN_IDS)[number];

/** The entitlement plan id used by the credit system (free | pro). */
export type EntitlementPlanId = 'free' | 'pro';

export function entitlementPlanFor(billingPlan: BillingPlanId): EntitlementPlanId {
  return billingPlan === 'free' ? 'free' : 'pro';
}

export function isProPlan(plan: BillingPlanId): boolean {
  return plan !== 'free';
}

export interface PlanDefinition {
  id: BillingPlanId;
  label: string;
  interval: 'month' | 'year';
  /** Price in cents. Free is 0. */
  priceCents: number;
  currency: BillingCurrency;
  /** Subscription credits granted per billing period. 0 for free. */
  subscriptionCreditsPerPeriod: number;
  /** Free daily credits. Shared across all plans. */
  dailyCredits: number;
  active: boolean;
}

export const PLANS: Record<BillingPlanId, PlanDefinition> = {
  free: {
    id: 'free',
    label: 'Free',
    interval: 'month',
    priceCents: 0,
    currency: BILLING_CURRENCY,
    subscriptionCreditsPerPeriod: 0,
    dailyCredits: 10,
    active: true,
  },
  pro_monthly: {
    id: 'pro_monthly',
    label: 'Pro Monthly',
    interval: 'month',
    priceCents: 799,
    currency: BILLING_CURRENCY,
    subscriptionCreditsPerPeriod: 1000,
    dailyCredits: 10,
    active: true,
  },
  pro_annual: {
    id: 'pro_annual',
    label: 'Pro Annual',
    interval: 'year',
    priceCents: 6900,
    currency: BILLING_CURRENCY,
    subscriptionCreditsPerPeriod: 1000,
    dailyCredits: 10,
    active: true,
  },
};

export function planDefinition(plan: BillingPlanId): PlanDefinition {
  return PLANS[plan];
}

export function isBillingPlanId(value: unknown): value is BillingPlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

// ── Credit Packs ───────────────────────────────────────────────────────────────────────────────

export const CREDIT_PACK_IDS = ['starter', 'standard', 'power'] as const;
export type CreditPackId = (typeof CREDIT_PACK_IDS)[number];

export interface CreditPackDefinition {
  id: CreditPackId;
  label: string;
  credits: number;
  priceCents: number;
  currency: BillingCurrency;
  active: boolean;
}

export const CREDIT_PACKS: Record<CreditPackId, CreditPackDefinition> = {
  starter: {
    id: 'starter',
    label: 'Starter',
    credits: 100,
    priceCents: 199,
    currency: BILLING_CURRENCY,
    active: true,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    credits: 500,
    priceCents: 599,
    currency: BILLING_CURRENCY,
    active: true,
  },
  power: {
    id: 'power',
    label: 'Power',
    credits: 1500,
    priceCents: 1299,
    currency: BILLING_CURRENCY,
    active: true,
  },
};

export function creditPackDefinition(pack: CreditPackId): CreditPackDefinition {
  return CREDIT_PACKS[pack];
}

export function isCreditPackId(value: unknown): value is CreditPackId {
  return typeof value === 'string' && (CREDIT_PACK_IDS as readonly string[]).includes(value);
}

// ── Money formatting ───────────────────────────────────────────────────────────────────────────

/** Format cents as a currency string. Never uses floating-point division for display. */
export function formatMoney(cents: number, currency: BillingCurrency = BILLING_CURRENCY): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return '$0.00';
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const sign = currency === 'USD' ? '$' : '$';
  return `${sign}${dollars}.${String(remainder).padStart(2, '0')}`;
}

/**
 * Derive a safe, server-authoritative checkout description for a plan or pack.
 * This is what Bachs sees; the frontend never submits an amount.
 */
export function planCheckoutDescription(plan: BillingPlanId): string {
  const def = planDefinition(plan);
  if (def.priceCents === 0) return 'Free plan';
  const interval = def.interval === 'month' ? 'monthly' : 'annual';
  return `Intake Pro ${interval}`;
}

export function packCheckoutDescription(pack: CreditPackId): string {
  const def = creditPackDefinition(pack);
  return `Intake ${def.label} credit pack (${def.credits} credits)`;
}
