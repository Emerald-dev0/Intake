/**
 * Billing data store.
 *
 * PostgreSQL implementation for the billing tables. All operations use appropriate
 * transactions and idempotency checks to prevent duplicate processing.
 *
 * The in-memory implementation is for tests and mirrors the same semantics.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  BillingCreditPurchase, BillingCustomer, BillingPayment, BillingSubscription,
  BillingSubscriptionStatus, BillingWebhookEvent, PaymentStatus,
} from './types';
import type { BillingCurrency, BillingPlanId, CreditPackId } from './plans';

// ── Store interface ────────────────────────────────────────────────────────────────────────────

export interface BillingStore {
  // Customers
  getCustomer(userId: string): Promise<BillingCustomer | null>;
  createCustomer(input: { userId: string; providerCustomerId: string | null; provider: string }): Promise<BillingCustomer>;
  updateCustomerProvider(userId: string, providerCustomerId: string): Promise<BillingCustomer | null>;

  // Subscriptions
  getSubscription(userId: string): Promise<BillingSubscription | null>;
  getSubscriptionByProviderId(providerSubscriptionId: string): Promise<BillingSubscription | null>;
  createSubscription(input: {
    userId: string;
    plan: BillingPlanId;
    providerSubscriptionId: string | null;
    status: BillingSubscriptionStatus;
    interval: 'month' | 'year';
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  }): Promise<BillingSubscription>;
  updateSubscription(id: string, update: {
    status?: BillingSubscriptionStatus;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: Date | null;
    providerSubscriptionId?: string | null;
  }): Promise<BillingSubscription | null>;

  // Payments
  createPayment(input: {
    userId: string;
    amountCents: number;
    currency: BillingCurrency;
    purpose: 'subscription' | 'subscription_renewal' | 'credit_pack';
    provider: string;
    providerTransactionId: string | null;
    status: PaymentStatus;
    subscriptionId?: string | null;
    creditPurchaseId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<BillingPayment>;
  getPayment(id: string): Promise<BillingPayment | null>;
  getPaymentByProviderTransactionId(providerTransactionId: string): Promise<BillingPayment | null>;
  updatePayment(id: string, update: {
    status?: PaymentStatus;
    providerTransactionId?: string | null;
  }): Promise<BillingPayment | null>;
  listPayments(userId: string, options: { limit: number; offset: number }): Promise<{ items: BillingPayment[]; total: number }>;

  // Credit purchases
  createCreditPurchase(input: {
    userId: string;
    pack: CreditPackId;
    credits: number;
    amountCents: number;
    currency: BillingCurrency;
    paymentId?: string | null;
  }): Promise<BillingCreditPurchase>;
  getCreditPurchase(id: string): Promise<BillingCreditPurchase | null>;
  grantCreditPurchase(id: string): Promise<BillingCreditPurchase | null>;
  listCreditPurchases(userId: string, options: { limit: number; offset: number }): Promise<{ items: BillingCreditPurchase[]; total: number }>;
  getPurchasedCreditBalance(userId: string): Promise<number>;

  // Webhook events (idempotency)
  recordWebhookEvent(input: {
    provider: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<{ isNew: boolean; event: BillingWebhookEvent }>;
  markWebhookProcessed(id: string): Promise<void>;
  findWebhookEvent(eventId: string): Promise<BillingWebhookEvent | null>;
}

// ── PostgreSQL implementation ──────────────────────────────────────────────────────────────────

export function createPostgresBillingStore(pool: Pool): BillingStore {
  return {
    // Customers ──────────────────────────────────────────────────────────────────────────────
    async getCustomer(userId) {
      const result = await pool.query(
        `SELECT id, user_id, provider_customer_id, provider, created_at, updated_at
         FROM billing_customer WHERE user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? mapCustomer(row) : null;
    },

    async createCustomer(input) {
      const result = await pool.query(
        `INSERT INTO billing_customer (id, user_id, provider_customer_id, provider)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, billing_customer.provider_customer_id),
           updated_at = now()
         RETURNING *`,
        [randomUUID(), input.userId, input.providerCustomerId, input.provider],
      );
      return mapCustomer(result.rows[0]);
    },

    async updateCustomerProvider(userId, providerCustomerId) {
      const result = await pool.query(
        `UPDATE billing_customer SET provider_customer_id = $2, updated_at = now()
         WHERE user_id = $1 RETURNING *`,
        [userId, providerCustomerId],
      );
      return result.rows[0] ? mapCustomer(result.rows[0]) : null;
    },

    // Subscriptions ──────────────────────────────────────────────────────────────────────────
    async getSubscription(userId) {
      const result = await pool.query(
        `SELECT * FROM billing_subscription WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      return result.rows[0] ? mapSubscription(result.rows[0]) : null;
    },

    async getSubscriptionByProviderId(providerSubscriptionId) {
      const result = await pool.query(
        `SELECT * FROM billing_subscription WHERE provider_subscription_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [providerSubscriptionId],
      );
      return result.rows[0] ? mapSubscription(result.rows[0]) : null;
    },

    async createSubscription(input) {
      const result = await pool.query(
        `INSERT INTO billing_subscription
         (id, user_id, plan, provider_subscription_id, status, interval, current_period_start, current_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [randomUUID(), input.userId, input.plan, input.providerSubscriptionId, input.status,
         input.interval, input.currentPeriodStart, input.currentPeriodEnd],
      );
      return mapSubscription(result.rows[0]);
    },

    async updateSubscription(id, update) {
      const sets: string[] = ['updated_at = now()'];
      const values: unknown[] = [];
      let idx = 1;

      if (update.status !== undefined) { sets.push(`status = $${++idx}`); values.push(update.status); }
      if (update.currentPeriodStart !== undefined) { sets.push(`current_period_start = $${++idx}`); values.push(update.currentPeriodStart); }
      if (update.currentPeriodEnd !== undefined) { sets.push(`current_period_end = $${++idx}`); values.push(update.currentPeriodEnd); }
      if (update.cancelAtPeriodEnd !== undefined) { sets.push(`cancel_at_period_end = $${++idx}`); values.push(update.cancelAtPeriodEnd); }
      if (update.canceledAt !== undefined) { sets.push(`canceled_at = $${++idx}`); values.push(update.canceledAt); }
      if (update.providerSubscriptionId !== undefined) { sets.push(`provider_subscription_id = $${++idx}`); values.push(update.providerSubscriptionId); }

      values.unshift(id);
      const result = await pool.query(
        `UPDATE billing_subscription SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        values,
      );
      return result.rows[0] ? mapSubscription(result.rows[0]) : null;
    },

    // Payments ───────────────────────────────────────────────────────────────────────────────
    async createPayment(input) {
      const result = await pool.query(
        `INSERT INTO billing_payment
         (id, user_id, amount_cents, currency, purpose, provider, provider_transaction_id, status, subscription_id, credit_purchase_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [randomUUID(), input.userId, input.amountCents, input.currency, input.purpose,
         input.provider, input.providerTransactionId, input.status,
         input.subscriptionId ?? null, input.creditPurchaseId ?? null,
         JSON.stringify(input.metadata ?? {})],
      );
      return mapPayment(result.rows[0]);
    },

    async getPayment(id) {
      const result = await pool.query('SELECT * FROM billing_payment WHERE id = $1', [id]);
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    },

    async getPaymentByProviderTransactionId(providerTransactionId) {
      const result = await pool.query(
        'SELECT * FROM billing_payment WHERE provider_transaction_id = $1 LIMIT 1',
        [providerTransactionId],
      );
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    },

    async updatePayment(id, update) {
      const sets: string[] = ['updated_at = now()'];
      const values: unknown[] = [id];
      let idx = 1;

      if (update.status !== undefined) { sets.push(`status = $${++idx}`); values.push(update.status); }
      if (update.providerTransactionId !== undefined) { sets.push(`provider_transaction_id = $${++idx}`); values.push(update.providerTransactionId); }

      const result = await pool.query(
        `UPDATE billing_payment SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        values,
      );
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    },

    async listPayments(userId, options) {
      const [items, countResult] = await Promise.all([
        pool.query(
          `SELECT * FROM billing_payment WHERE user_id = $1
           ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [userId, options.limit, options.offset],
        ),
        pool.query('SELECT COUNT(*)::int AS total FROM billing_payment WHERE user_id = $1', [userId]),
      ]);
      return {
        items: items.rows.map(mapPayment),
        total: countResult.rows[0]?.total ?? 0,
      };
    },

    // Credit purchases ───────────────────────────────────────────────────────────────────────
    async createCreditPurchase(input) {
      const result = await pool.query(
        `INSERT INTO billing_credit_purchase
         (id, user_id, pack, credits, amount_cents, currency, payment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [randomUUID(), input.userId, input.pack, input.credits, input.amountCents,
         input.currency, input.paymentId ?? null],
      );
      return mapCreditPurchase(result.rows[0]);
    },

    async getCreditPurchase(id) {
      const result = await pool.query('SELECT * FROM billing_credit_purchase WHERE id = $1', [id]);
      return result.rows[0] ? mapCreditPurchase(result.rows[0]) : null;
    },

    async grantCreditPurchase(id) {
      // Only grant once: if status is already 'granted', this is idempotent.
      const result = await pool.query(
        `UPDATE billing_credit_purchase
         SET status = 'granted', granted_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id],
      );
      return result.rows[0] ? mapCreditPurchase(result.rows[0]) : null;
    },

    async listCreditPurchases(userId, options) {
      const [items, countResult] = await Promise.all([
        pool.query(
          `SELECT * FROM billing_credit_purchase WHERE user_id = $1
           ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [userId, options.limit, options.offset],
        ),
        pool.query('SELECT COUNT(*)::int AS total FROM billing_credit_purchase WHERE user_id = $1', [userId]),
      ]);
      return {
        items: items.rows.map(mapCreditPurchase),
        total: countResult.rows[0]?.total ?? 0,
      };
    },

    async getPurchasedCreditBalance(userId) {
      // Sum of granted purchases minus sum of consumed from purchased bucket
      const result = await pool.query(
        `SELECT COALESCE(
          (SELECT COALESCE(SUM(credits), 0) FROM credit_ledger
           WHERE user_id = $1 AND entry_type = 'credit_purchase'),
          0
        ) + (
          SELECT COALESCE(SUM(credits), 0) FROM credit_ledger
          WHERE user_id = $1 AND entry_type = 'ai_consumption' AND bucket = 'purchased'
        ) AS balance`,
        [userId],
      );
      return Number(result.rows[0]?.balance ?? 0);
    },

    // Webhook events ─────────────────────────────────────────────────────────────────────────
    async recordWebhookEvent(input) {
      try {
        const result = await pool.query(
          `INSERT INTO billing_webhook_event (id, provider, event_id, event_type, payload)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (provider, event_id) DO NOTHING
           RETURNING *`,
          [randomUUID(), input.provider, input.eventId, input.eventType, JSON.stringify(input.payload)],
        );
        if (result.rows[0]) {
          return { isNew: true, event: mapWebhookEvent(result.rows[0]) };
        }
        // Event already exists — idempotency
        const existing = await pool.query(
          'SELECT * FROM billing_webhook_event WHERE provider = $1 AND event_id = $2',
          [input.provider, input.eventId],
        );
        return { isNew: false, event: mapWebhookEvent(existing.rows[0]) };
      } catch (error) {
        // Race condition: another process inserted the same event between our INSERT and SELECT
        const existing = await pool.query(
          'SELECT * FROM billing_webhook_event WHERE provider = $1 AND event_id = $2',
          [input.provider, input.eventId],
        );
        if (existing.rows[0]) {
          return { isNew: false, event: mapWebhookEvent(existing.rows[0]) };
        }
        throw error;
      }
    },

    async markWebhookProcessed(id) {
      await pool.query(
        `UPDATE billing_webhook_event SET processed = true, processed_at = now() WHERE id = $1`,
        [id],
      );
    },

    async findWebhookEvent(eventId) {
      const result = await pool.query(
        'SELECT * FROM billing_webhook_event WHERE event_id = $1 LIMIT 1',
        [eventId],
      );
      return result.rows[0] ? mapWebhookEvent(result.rows[0]) : null;
    },
  };
}

// ── Row mappers ────────────────────────────────────────────────────────────────────────────────

function mapCustomer(row: Record<string, unknown>): BillingCustomer {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    providerCustomerId: row.provider_customer_id as string | null,
    provider: row.provider as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapSubscription(row: Record<string, unknown>): BillingSubscription {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    plan: row.plan as BillingPlanId,
    providerSubscriptionId: row.provider_subscription_id as string | null,
    status: row.status as BillingSubscriptionStatus,
    interval: row.interval as 'month' | 'year',
    currentPeriodStart: row.current_period_start as Date | null,
    currentPeriodEnd: row.current_period_end as Date | null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: row.canceled_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapPayment(row: Record<string, unknown>): BillingPayment {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>) ?? {};
  } catch { metadata = {}; }
  return {
    id: row.id as string,
    userId: row.user_id as string,
    amountCents: Number(row.amount_cents),
    currency: row.currency as BillingCurrency,
    purpose: row.purpose as BillingPayment['purpose'],
    provider: row.provider as string,
    providerTransactionId: row.provider_transaction_id as string | null,
    status: row.status as PaymentStatus,
    subscriptionId: row.subscription_id as string | null,
    creditPurchaseId: row.credit_purchase_id as string | null,
    metadata,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapCreditPurchase(row: Record<string, unknown>): BillingCreditPurchase {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    pack: row.pack as CreditPackId,
    credits: Number(row.credits),
    amountCents: Number(row.amount_cents),
    currency: row.currency as BillingCurrency,
    paymentId: row.payment_id as string | null,
    status: row.status as BillingCreditPurchase['status'],
    grantedAt: row.granted_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapWebhookEvent(row: Record<string, unknown>): BillingWebhookEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload as Record<string, unknown>) ?? {};
  } catch { payload = {}; }
  return {
    id: row.id as string,
    provider: row.provider as string,
    eventId: row.event_id as string,
    eventType: row.event_type as string,
    payload,
    processed: Boolean(row.processed),
    processedAt: row.processed_at as Date | null,
    createdAt: row.created_at as Date,
  };
}

// ── Memory implementation ──────────────────────────────────────────────────────────────────────

export function createMemoryBillingStore(): BillingStore {
  const customers = new Map<string, BillingCustomer>();
  const subscriptions = new Map<string, BillingSubscription>();
  const payments = new Map<string, BillingPayment>();
  const creditPurchases = new Map<string, BillingCreditPurchase>();
  const webhookEvents = new Map<string, BillingWebhookEvent>();

  return {
    async getCustomer(userId) {
      for (const c of customers.values()) if (c.userId === userId) return { ...c };
      return null;
    },
    async createCustomer(input) {
      // Check for existing
      for (const c of customers.values()) {
        if (c.userId === input.userId) {
          c.providerCustomerId = input.providerCustomerId ?? c.providerCustomerId;
          c.updatedAt = new Date();
          return { ...c };
        }
      }
      const customer: BillingCustomer = {
        id: randomUUID(), userId: input.userId,
        providerCustomerId: input.providerCustomerId, provider: input.provider,
        createdAt: new Date(), updatedAt: new Date(),
      };
      customers.set(customer.id, customer);
      return { ...customer };
    },
    async updateCustomerProvider(userId, providerCustomerId) {
      for (const c of customers.values()) {
        if (c.userId === userId) { c.providerCustomerId = providerCustomerId; c.updatedAt = new Date(); return { ...c }; }
      }
      return null;
    },

    async getSubscription(userId) {
      let latest: BillingSubscription | null = null;
      for (const s of subscriptions.values()) {
        if (s.userId === userId && (!latest || s.createdAt > latest.createdAt)) latest = s;
      }
      return latest ? { ...latest } : null;
    },
    async getSubscriptionByProviderId(providerSubscriptionId) {
      for (const s of subscriptions.values()) if (s.providerSubscriptionId === providerSubscriptionId) return { ...s };
      return null;
    },
    async createSubscription(input) {
      const sub: BillingSubscription = {
        id: randomUUID(), userId: input.userId, plan: input.plan,
        providerSubscriptionId: input.providerSubscriptionId, status: input.status,
        interval: input.interval, currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: false,
        canceledAt: null, createdAt: new Date(), updatedAt: new Date(),
      };
      subscriptions.set(sub.id, sub);
      return { ...sub };
    },
    async updateSubscription(id, update) {
      const sub = subscriptions.get(id);
      if (!sub) return null;
      if (update.status !== undefined) sub.status = update.status;
      if (update.currentPeriodStart !== undefined) sub.currentPeriodStart = update.currentPeriodStart;
      if (update.currentPeriodEnd !== undefined) sub.currentPeriodEnd = update.currentPeriodEnd;
      if (update.cancelAtPeriodEnd !== undefined) sub.cancelAtPeriodEnd = update.cancelAtPeriodEnd;
      if (update.canceledAt !== undefined) sub.canceledAt = update.canceledAt;
      if (update.providerSubscriptionId !== undefined) sub.providerSubscriptionId = update.providerSubscriptionId;
      sub.updatedAt = new Date();
      return { ...sub };
    },

    async createPayment(input) {
      const payment: BillingPayment = {
        id: randomUUID(), userId: input.userId, amountCents: input.amountCents,
        currency: input.currency, purpose: input.purpose, provider: input.provider,
        providerTransactionId: input.providerTransactionId, status: input.status,
        subscriptionId: input.subscriptionId ?? null, creditPurchaseId: input.creditPurchaseId ?? null,
        metadata: input.metadata ?? {}, createdAt: new Date(), updatedAt: new Date(),
      };
      payments.set(payment.id, payment);
      return { ...payment };
    },
    async getPayment(id) { return payments.has(id) ? { ...payments.get(id)! } : null; },
    async getPaymentByProviderTransactionId(tid) {
      for (const p of payments.values()) if (p.providerTransactionId === tid) return { ...p };
      return null;
    },
    async updatePayment(id, update) {
      const p = payments.get(id); if (!p) return null;
      if (update.status !== undefined) p.status = update.status;
      if (update.providerTransactionId !== undefined) p.providerTransactionId = update.providerTransactionId;
      p.updatedAt = new Date();
      return { ...p };
    },
    async listPayments(userId, options) {
      const all = Array.from(payments.values()).filter(p => p.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: all.slice(options.offset, options.offset + options.limit).map(p => ({ ...p })), total: all.length };
    },

    async createCreditPurchase(input) {
      const purchase: BillingCreditPurchase = {
        id: randomUUID(), userId: input.userId, pack: input.pack, credits: input.credits,
        amountCents: input.amountCents, currency: input.currency,
        paymentId: input.paymentId ?? null, status: 'pending',
        grantedAt: null, createdAt: new Date(), updatedAt: new Date(),
      };
      creditPurchases.set(purchase.id, purchase);
      return { ...purchase };
    },
    async getCreditPurchase(id) { return creditPurchases.has(id) ? { ...creditPurchases.get(id)! } : null; },
    async grantCreditPurchase(id) {
      const p = creditPurchases.get(id);
      if (!p || p.status !== 'pending') return null;
      p.status = 'granted'; p.grantedAt = new Date(); p.updatedAt = new Date();
      return { ...p };
    },
    async listCreditPurchases(userId, options) {
      const all = Array.from(creditPurchases.values()).filter(p => p.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: all.slice(options.offset, options.offset + options.limit).map(p => ({ ...p })), total: all.length };
    },
    async getPurchasedCreditBalance() { return 0; }, // Simplified for memory store

    async recordWebhookEvent(input) {
      const key = `${input.provider}:${input.eventId}`;
      const existing = webhookEvents.get(key);
      if (existing) return { isNew: false, event: { ...existing } };
      const event: BillingWebhookEvent = {
        id: randomUUID(), provider: input.provider, eventId: input.eventId,
        eventType: input.eventType, payload: input.payload,
        processed: false, processedAt: null, createdAt: new Date(),
      };
      webhookEvents.set(key, event);
      return { isNew: true, event: { ...event } };
    },
    async markWebhookProcessed(id) {
      for (const e of webhookEvents.values()) {
        if (e.id === id) { e.processed = true; e.processedAt = new Date(); return; }
      }
    },
    async findWebhookEvent(eventId) {
      for (const e of webhookEvents.values()) if (e.eventId === eventId) return { ...e };
      return null;
    },
  };
}
