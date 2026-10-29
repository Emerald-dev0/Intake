import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createBachsWebhookRouter, createBillingRouter } from '../server/billing/routes.ts';
import { createBillingService } from '../server/billing/service.ts';
import { createMemoryBillingStore } from '../server/billing/store.ts';
import { createCreditService } from '../server/credits/service.ts';
import { createMemoryCreditStore } from '../server/credits/ledger.ts';

/**
 * Payments and subscriptions.
 *
 * The rules that matter, and that a redirect cannot fake:
 *
 * - The webhook is the authority. A signature that does not verify is refused.
 * - The same delivery twice is one payment, not two.
 * - The full lifecycle moves the plan: activated, renewed, canceled, ended.
 * - Live billing is gated, and a deployment with it off does not take money.
 */

const SECRET = 'whsec_test_secret';

let server;
let baseUrl;
let store;
let credits;
let billing;
let providerEvents;

/** A provider that signs with the shared secret, the way Bachs does. */
const paymentProvider = {
  configured: true,
  async createCheckoutSession(input) {
    return {
      id: `cs_${input.metadata.userId}`,
      url: `https://checkout.test/${input.metadata.userId}`,
      status: 'pending',
      provider: 'bachs',
    };
  },
  async getCheckoutSession(id) {
    return { id, url: 'https://checkout.test/x', status: 'completed', provider: 'bachs' };
  },
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!signatureHeader) return false;
    // A plain comparison: the test is about the flow, not about the constant-time comparison.
    return signatureHeader === `sha256=${Buffer.from(`${SECRET}:${rawBody}`).toString('hex')}`;
  },
  // The same mapping the Bachs adapter does, so the test exercises the real shape.
  parseWebhookEvent(rawBody) {
    try {
      const payload = JSON.parse(rawBody);
      const eventType = typeof payload.type === 'string' ? payload.type : '';
      const data = payload.data ?? payload;
      const status = data.status === 'succeeded' || data.status === 'paid' ? 'succeeded'
        : data.status === 'failed' ? 'failed'
        : data.status === 'canceled' ? 'canceled' : 'pending';
      return {
        id: typeof payload.id === 'string' ? payload.id : 'evt_unknown',
        type: eventType,
        transactionId: typeof data.transaction_id === 'string' ? data.transaction_id : null,
        amountCents: typeof data.amount === 'number' ? data.amount : null,
        currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : null,
        status,
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
        rawPayload: payload,
        receivedAt: new Date(),
      };
    } catch {
      return null;
    }
  },
};

function sign(body) {
  return `sha256=${Buffer.from(`${SECRET}:${body}`).toString('hex')}`;
}

async function post(path, body, { signature } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bachs-signature': signature ?? sign(raw) },
    body: raw,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, body: json };
}

before(async () => {
  store = createMemoryBillingStore();
  credits = createCreditService({ store: createMemoryCreditStore(), now: () => new Date('2026-10-29T00:00:00.000Z') });
  providerEvents = [];
  billing = createBillingService({
    store,
    credits,
    paymentProvider,
    onBillingEvent: event => { providerEvents.push(event); },
  });

  const app = express();
  app.use('/api/webhooks/bachs', createBachsWebhookRouter({ billing, paymentProvider }));
  app.use('/api/billing', createBillingRouter({
    billing,
    store,
    paymentProvider,
    getSession: async () => ({ id: 'user_owner', email: 'owner@example.com', name: 'Owner' }),
  }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('a webhook with the wrong signature is refused', async () => {
  const response = await post('/api/webhooks/bachs', { id: 'evt_bad', type: 'payment.succeeded' }, { signature: 'sha256=nope' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'invalid_signature');
});

test('a webhook with no signature is refused', async () => {
  const response = await post('/api/webhooks/bachs', { id: 'evt_none', type: 'payment.succeeded' }, { signature: '' });
  assert.equal(response.status, 401);
});

test('a payment activates the plan, and the plan is what the account gets', async () => {
  const event = {
    id: 'evt_paid_1',
    type: 'payment.succeeded',
    data: {
      transaction_id: 'txn_1',
      amount: 799,
      currency: 'USD',
      status: 'succeeded',
      metadata: { userId: 'user_owner', purpose: 'subscription', plan: 'pro_monthly', subscriptionId: 'sub_bachs_1' },
    },
  };
  const response = await post('/api/webhooks/bachs', event);
  assert.equal(response.status, 200);
  assert.equal(response.body.received, true);

  const summary = await billing.getBillingSummary('user_owner');
  assert.equal(summary.subscriptionActive, true);
  assert.equal(summary.plan, 'pro', 'the entitlement plan is the Pro plan');
});

test('the same delivery twice is one payment', async () => {
  const event = {
    id: 'evt_paid_1',
    type: 'payment.succeeded',
    data: {
      transaction_id: 'txn_1',
      amount: 799,
      currency: 'USD',
      status: 'succeeded',
      metadata: { userId: 'user_owner', purpose: 'subscription', plan: 'pro_monthly', subscriptionId: 'sub_bachs_1' },
    },
  };
  const replay = await post('/api/webhooks/bachs', event);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
});

test('a renewal moves the period forward', async () => {
  const response = await post('/api/webhooks/bachs', {
    id: 'evt_paid_2',
    type: 'subscription.renewed',
    data: {
      transaction_id: 'txn_2',
      amount: 799,
      currency: 'USD',
      status: 'succeeded',
      metadata: {
        userId: 'user_owner', purpose: 'subscription', plan: 'pro_monthly', subscriptionId: 'sub_bachs_1',
        periodStart: '2026-11-29T00:00:00.000Z', periodEnd: '2026-12-29T00:00:00.000Z',
      },
    },
  });
  assert.equal(response.status, 200);
  const subscription = await store.getSubscription('user_owner');
  assert.equal(subscription.currentPeriodEnd.toISOString().slice(0, 10), '2026-12-29');
});

test('a cancellation is recorded, and the plan survives until the period ends', async () => {
  const response = await post('/api/webhooks/bachs', {
    id: 'evt_cancel_1',
    type: 'subscription.canceled',
    data: {
      status: 'canceled',
      metadata: { userId: 'user_owner', subscriptionId: 'sub_bachs_1', cancelAtPeriodEnd: true },
    },
  });
  assert.equal(response.status, 200);
  const subscription = await store.getSubscription('user_owner');
  assert.equal(subscription.cancelAtPeriodEnd, true);
  const summary = await billing.getBillingSummary('user_owner');
  assert.equal(summary.subscriptionActive, true, 'the plan still works until the period ends');
});

test('the end of the subscription takes the plan away', async () => {
  const response = await post('/api/webhooks/bachs', {
    id: 'evt_end_1',
    type: 'subscription.expired',
    data: {
      status: 'canceled',
      metadata: { userId: 'user_owner', subscriptionId: 'sub_bachs_1' },
    },
  });
  assert.equal(response.status, 200);
  const summary = await billing.getBillingSummary('user_owner');
  assert.equal(summary.subscriptionActive, false);
});

test('the live gate holds: with paid billing off, no checkout is created', async () => {
  const response = await fetch(`${baseUrl}/api/billing/checkout/subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'pro_monthly', successUrl: 'https://intake.test/ok', cancelUrl: 'https://intake.test/no' }),
  });
  const body = await response.json().catch(() => ({}));
  assert.ok(response.status >= 400, 'the checkout is refused while live billing is off');
  assert.ok(body.error || body.message, 'and it says why');
});
