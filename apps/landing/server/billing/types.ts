/**
 * Billing domain types.
 *
 * These types represent the billing state of an Intake account. They are server-authoritative;
 * the frontend never sets them directly.
 */

import type { BillingCurrency, BillingPlanId, CreditPackId, EntitlementPlanId } from './plans';

// ── Subscription lifecycle ─────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'canceled',
  'expired',
  'incomplete',
  'trialing',
] as const;
export type BillingSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Subscription statuses where the user has paid benefits. */
export function isSubscriptionPaidStatus(status: BillingSubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing';
}

/** Subscription statuses where the user's access is ending or ended. */
export function isSubscriptionEndingStatus(status: BillingSubscriptionStatus): boolean {
  return status === 'canceled' || status === 'expired';
}

// ── Payment ────────────────────────────────────────────────────────────────────────────────────

export const PAYMENT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'canceled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PURPOSES = [
  'subscription',
  'subscription_renewal',
  'credit_pack',
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

// ── Records ────────────────────────────────────────────────────────────────────────────────────

export interface BillingCustomer {
  id: string;
  userId: string;
  providerCustomerId: string | null;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingSubscription {
  id: string;
  userId: string;
  plan: BillingPlanId;
  providerSubscriptionId: string | null;
  status: BillingSubscriptionStatus;
  interval: 'month' | 'year';
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingPayment {
  id: string;
  userId: string;
  amountCents: number;
  currency: BillingCurrency;
  purpose: PaymentPurpose;
  provider: string;
  providerTransactionId: string | null;
  status: PaymentStatus;
  subscriptionId: string | null;
  creditPurchaseId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingCreditPurchase {
  id: string;
  userId: string;
  pack: CreditPackId;
  credits: number;
  amountCents: number;
  currency: BillingCurrency;
  paymentId: string | null;
  status: 'pending' | 'granted' | 'failed' | 'refunded';
  grantedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingWebhookEvent {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processedAt: Date | null;
  createdAt: Date;
}

// ── Billing summary ────────────────────────────────────────────────────────────────────────────

export interface BillingSummary {
  plan: EntitlementPlanId;
  billingPlan: BillingPlanId | null;
  subscriptionStatus: 'none' | BillingSubscriptionStatus;
  subscription: {
    active: boolean;
    plan: BillingPlanId | null;
    status: BillingSubscriptionStatus | null;
    interval: 'month' | 'year' | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  purchasedCredits: number;
  nextRenewalDate: string | null;
}
