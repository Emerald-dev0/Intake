/**
 * Payment provider abstraction and Bachs adapter.
 *
 * Architecture:
 *   BillingService → PaymentService → PaymentProvider → BachsAdapter → Bachs API
 *
 * The billing domain only speaks `PaymentProvider`. Swapping the payment vendor is one file.
 *
 * Bachs is the current provider. All provider-specific knowledge lives in `BachsAdapter`.
 * The frontend never talks to Bachs directly for server-side operations; checkout redirects
 * to a Bachs-hosted page, and the result is confirmed server-side via webhook + return verification.
 */

import { createHmac, randomUUID } from 'node:crypto';
import type { BillingCurrency } from './plans';

// ── Payment provider interface ─────────────────────────────────────────────────────────────────

export type CheckoutSessionStatus = 'pending' | 'completed' | 'expired' | 'failed';

export interface CheckoutSession {
  id: string;
  providerSessionId: string;
  checkoutUrl: string;
  status: CheckoutSessionStatus;
  amountCents: number;
  currency: BillingCurrency;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateCheckoutInput {
  amountCents: number;
  currency: BillingCurrency;
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly id: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  getCheckoutSession(providerSessionId: string): Promise<CheckoutSession | null>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  parseWebhookEvent(rawBody: string): WebhookEvent | null;
}

export interface WebhookEvent {
  id: string;
  type: string;
  /** Provider-assigned payment/transaction id. */
  transactionId: string | null;
  amountCents: number | null;
  currency: string | null;
  status: 'succeeded' | 'failed' | 'pending' | 'refunded' | 'canceled' | 'unknown';
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  receivedAt: Date;
}

// ── Bachs configuration ────────────────────────────────────────────────────────────────────────

export interface BachsConfig {
  apiKey: string;
  baseUrl: string;
  webhookSecret: string;
  /** Public-facing success/cancel URL base for constructing return URLs. */
  appOrigin: string;
  configured: boolean;
}

export function readBachsConfig(env: NodeJS.ProcessEnv = process.env): BachsConfig {
  const apiKey = (env.BACHS_API_KEY ?? '').trim();
  const baseUrl = (env.BACHS_BASE_URL ?? '').trim() || 'https://api.bachs.io';
  const webhookSecret = (env.BACHS_WEBHOOK_SECRET ?? '').trim();
  const appOrigin = (env.BETTER_AUTH_URL ?? 'http://localhost:5173').trim();

  let configured = false;
  if (apiKey) {
    // Validate URL shape without logging secrets
    try {
      const url = new URL(baseUrl);
      configured = url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
    } catch {
      configured = false;
    }
  }

  return { apiKey, baseUrl, webhookSecret, appOrigin, configured };
}

// ── Bachs adapter ──────────────────────────────────────────────────────────────────────────────

/**
 * Bachs payment provider adapter.
 *
 * This adapter translates between the Intake `PaymentProvider` interface and the Bachs HTTP API.
 * It handles authentication, request formatting, response parsing, and webhook signature verification.
 *
 * Bachs checkout flow:
 * 1. Server creates a checkout session via `POST /v1/checkouts`
 * 2. User is redirected to the Bachs-hosted checkout page
 * 3. User completes payment on Bachs
 * 4. Bachs redirects user back to `successUrl`
 * 5. Bachs sends a webhook to Intake's billing webhook endpoint
 * 6. Intake verifies the webhook signature, processes the event idempotently
 *
 * The frontend never marks a payment as successful. Server-side webhook confirmation is authoritative.
 */
export function createBachsAdapter(config: BachsConfig): PaymentProvider {
  const TIMEOUT_MS = 15_000;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new BachsError(`Bachs API ${method} ${path} returned ${response.status}`, response.status, text);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: 'bachs',

    async createCheckout(input) {
      if (!config.configured) {
        throw new BachsError('Bachs payment provider is not configured', 0, '');
      }

      const response = await request<{
        id: string;
        checkout_url: string;
        status: string;
        amount: number;
        currency: string;
        created_at: string;
      }>('POST', '/v1/checkouts', {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        description: input.description,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail,
        metadata: input.metadata,
      });

      return {
        id: `checkout_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        providerSessionId: response.id,
        checkoutUrl: response.checkout_url,
        status: mapCheckoutStatus(response.status),
        amountCents: response.amount,
        currency: (response.currency?.toUpperCase() ?? input.currency) as BillingCurrency,
        metadata: input.metadata,
        createdAt: new Date(response.created_at ?? Date.now()),
      };
    },

    async getCheckoutSession(providerSessionId) {
      if (!config.configured) return null;
      try {
        const response = await request<{
          id: string;
          checkout_url: string;
          status: string;
          amount: number;
          currency: string;
          created_at: string;
          metadata?: Record<string, unknown>;
        }>('GET', `/v1/checkouts/${encodeURIComponent(providerSessionId)}`);

        return {
          id: providerSessionId,
          providerSessionId: response.id,
          checkoutUrl: response.checkout_url,
          status: mapCheckoutStatus(response.status),
          amountCents: response.amount,
          currency: (response.currency?.toUpperCase() ?? 'USD') as BillingCurrency,
          metadata: response.metadata ?? {},
          createdAt: new Date(response.created_at ?? Date.now()),
        };
      } catch (error) {
        if (error instanceof BachsError && error.statusCode === 404) return null;
        throw error;
      }
    },

    verifyWebhookSignature(rawBody, signatureHeader) {
      if (!config.webhookSecret) return false;
      if (!signatureHeader) return false;

      // Bachs webhook signatures use HMAC-SHA256 of the raw body with the webhook secret
      const expected = createHmac('sha256', config.webhookSecret)
        .update(rawBody, 'utf8')
        .digest('hex');

      // Compare with timing-safe comparison to prevent timing attacks
      const provided = signatureHeader.replace(/^sha256=/, '');
      if (expected.length !== provided.length) return false;

      let result = 0;
      for (let i = 0; i < expected.length; i++) {
        result |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
      }
      return result === 0;
    },

    parseWebhookEvent(rawBody) {
      try {
        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        const eventType = typeof payload.type === 'string' ? payload.type : '';
        const data = (payload.data ?? payload) as Record<string, unknown>;

        const transactionId = typeof data.id === 'string' ? data.id
          : typeof data.transaction_id === 'string' ? data.transaction_id
          : typeof data.payment_id === 'string' ? data.payment_id
          : null;

        const amountCents = typeof data.amount === 'number' ? data.amount : null;
        const currency = typeof data.currency === 'string' ? data.currency.toUpperCase() : null;

        const status = mapPaymentStatus(
          typeof data.status === 'string' ? data.status : ''
        );

        const metadata = typeof data.metadata === 'object' && data.metadata !== null && !Array.isArray(data.metadata)
          ? data.metadata as Record<string, unknown>
          : {};

        return {
          id: typeof payload.id === 'string' ? payload.id : randomUUID(),
          type: eventType,
          transactionId,
          amountCents,
          currency,
          status,
          metadata,
          rawPayload: payload,
          receivedAt: new Date(),
        };
      } catch {
        return null;
      }
    },
  };
}

function mapCheckoutStatus(status: string): CheckoutSessionStatus {
  switch (status) {
    case 'completed':
    case 'paid':
    case 'succeeded':
      return 'completed';
    case 'expired':
      return 'expired';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

function mapPaymentStatus(status: string): WebhookEvent['status'] {
  switch (status) {
    case 'succeeded':
    case 'paid':
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'declined':
      return 'failed';
    case 'pending':
    case 'processing':
      return 'pending';
    case 'refunded':
      return 'refunded';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────

export class BachsError extends Error {
  constructor(message: string, readonly statusCode: number, readonly responseBody: string) {
    super(message);
    this.name = 'BachsError';
  }
}

// ── Memory provider (for testing) ──────────────────────────────────────────────────────────────

export interface MemoryPaymentProvider extends PaymentProvider {
  /** Manually complete a checkout to simulate a successful payment in tests. */
  simulatePayment(providerSessionId: string): void;
  /** Get all created checkout sessions for test assertions. */
  sessions(): CheckoutSession[];
}

export function createMemoryPaymentProvider(): MemoryPaymentProvider {
  const sessions = new Map<string, CheckoutSession>();

  return {
    id: 'memory',

    async createCheckout(input) {
      const providerSessionId = `mem_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const session: CheckoutSession = {
        id: `checkout_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        providerSessionId,
        checkoutUrl: `https://checkout.bachs.test/${providerSessionId}`,
        status: 'pending',
        amountCents: input.amountCents,
        currency: input.currency,
        metadata: input.metadata,
        createdAt: new Date(),
      };
      sessions.set(providerSessionId, session);
      return session;
    },

    async getCheckoutSession(providerSessionId) {
      return sessions.get(providerSessionId) ?? null;
    },

    verifyWebhookSignature(_rawBody, _signatureHeader) {
      return true;
    },

    parseWebhookEvent(rawBody) {
      try {
        return JSON.parse(rawBody) as WebhookEvent;
      } catch {
        return null;
      }
    },

    simulatePayment(providerSessionId) {
      const session = sessions.get(providerSessionId);
      if (session) session.status = 'completed';
    },

    sessions() {
      return Array.from(sessions.values());
    },
  };
}
