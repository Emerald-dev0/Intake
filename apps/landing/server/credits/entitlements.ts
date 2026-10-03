/**
 * Plans, buckets and reset conventions.
 *
 * Everything a plan means lives here. No route, engine or UI is allowed to branch on
 * `plan === 'pro'`; they ask this module for an allowance, a bucket or a reset time. That keeps the
 * future pricing page, Bachs.io billing and the admin dashboard able to change entitlements in one
 * place.
 */

export const PLAN_IDS = ['free', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const DEFAULT_PLAN: PlanId = 'free';

export const SUBSCRIPTION_STATUSES = ['none', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface PlanDefinition {
  id: PlanId;
  /** Granted once per UTC day. Resets daily; never rolls over. */
  dailyCredits: number;
  /** Granted once per billing period. Not purchased or transferred; never rolls over at launch. */
  monthlyCredits: number;
  label: string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: { id: 'free', dailyCredits: 20, monthlyCredits: 0, label: 'Free' },
  // Pro = the same 20 daily credits plus a 500-credit monthly reserve for that billing period.
  pro: { id: 'pro', dailyCredits: 20, monthlyCredits: 500, label: 'Pro' },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
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

export const CREDIT_BUCKETS = ['daily', 'monthly'] as const;
export type CreditBucket = (typeof CREDIT_BUCKETS)[number];

/** Consumption order is deliberate and documented: daily credits are spent before the monthly reserve. */
export const BUCKET_PRIORITY: readonly CreditBucket[] = ['daily', 'monthly'];

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
  return bucket === 'daily' ? definition.dailyCredits : definition.monthlyCredits;
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
    daily: bucketEnabled(plan, 'daily') ? buckets.daily : 0,
    monthly: bucketEnabled(plan, 'monthly') ? buckets.monthly : 0,
  };
}

export function periodKeyFor(bucket: CreditBucket, entitlement: Entitlement, now: Date): string {
  return bucket === 'daily' ? dailyPeriodKey(now) : monthlyPeriodKey(entitlement, now);
}

/** Balance/projection shape the browser is allowed to see. No tokens, no ledger internals. */
export interface CreditBalance {
  plan: PlanId;
  dailyRemaining: number;
  monthlyRemaining: number;
  nextDailyReset: string;
  nextMonthlyReset: string;
}

export function toPublicBalance(entitlement: Entitlement, buckets: Record<CreditBucket, number>, now: Date): CreditBalance {
  return {
    plan: entitlement.plan,
    dailyRemaining: Math.max(0, buckets.daily),
    monthlyRemaining: Math.max(0, buckets.monthly),
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
