/**
 * Plans, buckets and reset conventions.
 *
 * Everything a plan means lives here. No route, engine or UI is allowed to branch on
 * `plan === 'pro'`; they ask this module for an allowance, a bucket or a reset time. That keeps the
 * future pricing page, Bachs.io billing and the admin dashboard able to change entitlements in one
 * place.
 */

import { PLAN_CATALOG, PLAN_IDS, isPlanId, type PlanId } from '../../src/lib/plans';
export { PLAN_IDS, isPlanId };
export type { PlanId };

export const DEFAULT_PLAN: PlanId = 'free';

export const SUBSCRIPTION_STATUSES = ['none', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface PlanDefinition {
  id: PlanId;
  /** Granted once per UTC day. Resets daily; never rolls over. */
  dailyCredits: number;
  /** Granted once per billing period via the legacy monthly bucket. */
  monthlyCredits: number;
  /** Granted once per billing period via the subscription bucket (new billing model). */
  subscriptionCredits: number;
  label: string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: PLAN_CATALOG.free.id,
    dailyCredits: PLAN_CATALOG.free.dailyCredits,
    monthlyCredits: PLAN_CATALOG.free.monthlyCredits,
    subscriptionCredits: 0,
    label: PLAN_CATALOG.free.label,
  },
  pro: {
    id: PLAN_CATALOG.pro.id,
    dailyCredits: PLAN_CATALOG.pro.dailyCredits,
    monthlyCredits: PLAN_CATALOG.pro.monthlyCredits,
    subscriptionCredits: PLAN_CATALOG.pro.monthlyCredits,
    label: PLAN_CATALOG.pro.label,
  },
};

/**
 * Determines whether a plan should grant credits to the legacy 'monthly' bucket.
 * In the new billing model, Pro grants via the 'subscription' bucket instead.
 * Only plans that explicitly set monthlyCredits > 0 AND subscriptionCredits === 0 use the legacy bucket.
 */
export function usesLegacyMonthlyBucket(plan: PlanId): boolean {
  const def = planDefinition(plan);
  return def.monthlyCredits > 0 && def.subscriptionCredits === 0;
}

export function planDefinition(plan: PlanId): PlanDefinition {
  return PLANS[plan];
}

export interface Entitlement {
  userId: string;
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus;
  /** Set by the future billing system. When present it defines the monthly credit period. */
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

export const CREDIT_BUCKETS = ['daily', 'monthly', 'subscription', 'purchased', 'promotion'] as const;
export type CreditBucket = (typeof CREDIT_BUCKETS)[number];

/** Buckets that participate in consumption allocation order. */
export const SPENDABLE_BUCKETS = ['daily', 'subscription', 'monthly', 'purchased', 'promotion'] as const;
export type SpendableBucket = (typeof SPENDABLE_BUCKETS)[number];

/**
 * Consumption order is deliberate and documented:
 * 1. Free daily credits (expire at midnight UTC, never roll over)
 * 2. Subscription credits (from Pro plan, per billing period)
 * 3. Monthly credits (legacy bucket, for backward compat with existing data)
 * 4. Purchased credits (from credit packs, never expire)
 * 5. Promotional credits (if granted, per promotion rules)
 */
export const BUCKET_PRIORITY: readonly CreditBucket[] = ['daily', 'subscription', 'monthly', 'purchased', 'promotion'];

export const OPERATION_TYPES = ['form_create', 'form_edit', 'form_revise'] as const;
export type AiOperationType = (typeof OPERATION_TYPES)[number];

export function isOperationType(value: unknown): value is AiOperationType {
  return typeof value === 'string' && (OPERATION_TYPES as readonly string[]).includes(value);
}

const DAY_MS = 86_400_000;

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function utcMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Daily credits belong to a UTC calendar day. The server decides this, never the browser clock:
 * the frontend only displays the reset instant it is given.
 */
export function dailyPeriodKey(now: Date): string {
  return utcDayKey(now);
}

export function nextDailyReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

/**
 * The monthly reserve belongs to a billing period when billing supplies one, and otherwise to the
 * UTC calendar month. The key never changes for an existing period, so a grant can only happen once.
 */
export function monthlyPeriodKey(entitlement: Pick<Entitlement, 'currentPeriodStart'>, now: Date): string {
  return entitlement.currentPeriodStart ? utcMonthKey(entitlement.currentPeriodStart) : utcMonthKey(now);
}

export function nextMonthlyReset(entitlement: Pick<Entitlement, 'currentPeriodEnd'>, now: Date): Date {
  if (entitlement.currentPeriodEnd && entitlement.currentPeriodEnd.getTime() > now.getTime()) return entitlement.currentPeriodEnd;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** A grant is skipped entirely when a plan grants nothing, so no meaningless ledger rows appear. */
export function grantCredits(plan: PlanId, bucket: CreditBucket): number {
  const definition = planDefinition(plan);
  switch (bucket) {
    case 'daily': return definition.dailyCredits;
    case 'subscription': return definition.subscriptionCredits;
    case 'monthly': return definition.monthlyCredits;
    default: return 0;
  }
}

/** A bucket is only spendable while the current plan actually grants it. */
export function bucketEnabled(plan: PlanId, bucket: CreditBucket): boolean {
  return grantCredits(plan, bucket) > 0;
}

/**
 * Applies the plan to a raw ledger sum. Downgrading from Pro must not leave a spendable monthly
 * reserve behind, and history is never deleted — it simply stops counting for the current plan.
 */
export function applyPlanBuckets(plan: PlanId, buckets: Record<CreditBucket, number>): Record<CreditBucket, number> {
  return {
    daily: bucketEnabled(plan, 'daily') ? (buckets.daily ?? 0) : 0,
    monthly: bucketEnabled(plan, 'monthly') ? (buckets.monthly ?? 0) : 0,
    subscription: bucketEnabled(plan, 'subscription') ? (buckets.subscription ?? 0) : 0,
    purchased: buckets.purchased ?? 0,
    promotion: buckets.promotion ?? 0,
  };
}

export function periodKeyFor(bucket: CreditBucket, entitlement: Entitlement, now: Date): string {
  return bucket === 'daily' ? dailyPeriodKey(now) : monthlyPeriodKey(entitlement, now);
}

/** Balance/projection shape the browser is allowed to see. No tokens, no ledger internals. */
export interface CreditBalance {
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus;
  availableCredits: number;
  dailyRemaining: number;
  dailyLimit: number;
  monthlyRemaining: number;
  monthlyLimit: number;
  nextDailyReset: string;
  nextMonthlyReset: string;
}

export function toPublicBalance(entitlement: Entitlement, buckets: Record<CreditBucket, number>, now: Date): CreditBalance {
  const dailyRemaining = Math.max(0, buckets.daily ?? 0);
  // For the public balance, subscription and monthly credits are combined into monthlyRemaining.
  // This keeps the frontend contract stable while the internal bucket system expands.
  const subscriptionRemaining = Math.max(0, buckets.subscription ?? 0);
  const legacyMonthlyRemaining = Math.max(0, buckets.monthly ?? 0);
  const monthlyRemaining = subscriptionRemaining + legacyMonthlyRemaining;
  const purchasedRemaining = Math.max(0, buckets.purchased ?? 0);
  const promotionRemaining = Math.max(0, buckets.promotion ?? 0);
  const definition = planDefinition(entitlement.plan);
  // monthlyLimit shows the subscription credits (or legacy monthly) as the plan's monthly allowance
  const monthlyLimit = definition.subscriptionCredits || definition.monthlyCredits;
  return {
    plan: entitlement.plan,
    subscriptionStatus: entitlement.subscriptionStatus,
    availableCredits: dailyRemaining + monthlyRemaining + purchasedRemaining + promotionRemaining,
    dailyRemaining,
    dailyLimit: definition.dailyCredits,
    monthlyRemaining,
    monthlyLimit,
    nextDailyReset: nextDailyReset(now).toISOString(),
    nextMonthlyReset: nextMonthlyReset(entitlement, now).toISOString(),
  };
}

/** True when the entitlement is Pro *and* the subscription is in good standing. */
export function isProActive(entitlement: Pick<Entitlement, 'plan' | 'subscriptionStatus'>): boolean {
  return entitlement.plan === 'pro' && (entitlement.subscriptionStatus === 'active' || entitlement.subscriptionStatus === 'none');
}

export function dayLengthMs(): number {
  return DAY_MS;
}
