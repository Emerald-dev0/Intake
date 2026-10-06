/**
 * Billing HTTP routes.
 *
 * These routes expose the billing operations to the authenticated frontend:
 *   POST /api/billing/checkout/subscription   — create a subscription checkout session
 *   POST /api/billing/checkout/credit-pack    — create a credit-pack checkout session
 *   GET  /api/billing/summary                 — current billing state for the user
 *   GET  /api/billing/history                 — payment and purchase history
 *   GET  /api/billing/invoices                — receipts and invoices
 *   POST /api/billing/cancel                  — cancel subscription
 *   POST /api/webhooks/bachs                  — Bachs payment webhook (no auth, signature verified)
 *
 * All routes are server-authoritative. The frontend never submits prices, amounts or user IDs
 * that affect billing state.
 */

import { Router } from 'express';
import type { BillingService } from './service';
import type { PaymentProvider } from './payment-provider';
import type { BillingStore } from './store';
import { isBillingPlanId, isCreditPackId, PLANS, CREDIT_PACKS, formatMoney, planDefinition, creditPackDefinition } from './plans';

interface GetSession {
  (req: import('express').Request): Promise<{ id: string; email: string; name: string } | null>;
}

export interface BillingRouterOptions {
  billing: BillingService;
  store: BillingStore;
  paymentProvider: PaymentProvider;
  getSession: GetSession;
  webhookSecret?: string;
}

export function createBillingRouter(options: BillingRouterOptions): Router {
  const router = Router();

  // ── Auth middleware ───────────────────────────────────────────────────────────────────────

  async function requireAuth(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
    const session = await options.getSession(req);
    if (!session) return res.status(401).json({ error: 'not_authenticated' });
    (req as any).user = session;
    next();
  }

  // ── Public plan metadata (safe for display) ──────────────────────────────────────────────

  router.get('/plans', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      plans: Object.values(PLANS).map(p => ({
        id: p.id,
        label: p.label,
        interval: p.interval,
        priceCents: p.priceCents,
        priceFormatted: formatMoney(p.priceCents),
        currency: p.currency,
        dailyCredits: p.dailyCredits,
        subscriptionCreditsPerPeriod: p.subscriptionCreditsPerPeriod,
        active: p.active,
      })),
      creditPacks: Object.values(CREDIT_PACKS).map(p => ({
        id: p.id,
        label: p.label,
        credits: p.credits,
        priceCents: p.priceCents,
        priceFormatted: formatMoney(p.priceCents),
        currency: p.currency,
        active: p.active,
      })),
    });
  });

  // ── Checkout ─────────────────────────────────────────────────────────────────────────────

  router.post('/checkout/subscription', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const { plan } = req.body as { plan?: unknown };

      if (!isBillingPlanId(plan)) {
        return res.status(400).json({ error: 'invalid_plan', message: 'A valid plan is required.' });
      }

      const planDef = planDefinition(plan);
      if (planDef.priceCents === 0) {
        return res.status(400).json({ error: 'free_plan', message: 'The free plan does not require checkout.' });
      }
      if (!planDef.active) {
        return res.status(400).json({ error: 'plan_unavailable', message: 'This plan is not currently available.' });
      }

      const appOrigin = process.env.BETTER_AUTH_URL || 'http://localhost:5173';
      const result = await options.billing.createSubscriptionCheckout({
        userId: user.id,
        plan,
        successUrl: `${appOrigin}/app/billing?checkout=success`,
        cancelUrl: `${appOrigin}/app/billing?checkout=canceled`,
        customerEmail: user.email,
      });

      res.json({
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Checkout failed';
      res.status(500).json({ error: 'checkout_failed', message });
    }
  });

  router.post('/checkout/credit-pack', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const { pack } = req.body as { pack?: unknown };

      if (!isCreditPackId(pack)) {
        return res.status(400).json({ error: 'invalid_pack', message: 'A valid credit pack is required.' });
      }

      const packDef = creditPackDefinition(pack);
      if (!packDef.active) {
        return res.status(400).json({ error: 'pack_unavailable', message: 'This credit pack is not currently available.' });
      }

      const appOrigin = process.env.BETTER_AUTH_URL || 'http://localhost:5173';
      const result = await options.billing.createCreditPackCheckout({
        userId: user.id,
        pack,
        successUrl: `${appOrigin}/app/billing?checkout=success&pack=${pack}`,
        cancelUrl: `${appOrigin}/app/billing?checkout=canceled`,
        customerEmail: user.email,
      });

      res.json({
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Checkout failed';
      res.status(500).json({ error: 'checkout_failed', message });
    }
  });

  // ── Billing summary ──────────────────────────────────────────────────────────────────────

  router.get('/summary', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const summary = await options.billing.getBillingSummary(user.id);
      res.set('Cache-Control', 'no-store');
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: 'billing_unavailable' });
    }
  });

  // ── Billing history ──────────────────────────────────────────────────────────────────────

  router.get('/history', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const [payments, purchases] = await Promise.all([
        options.store.listPayments(user.id, { limit, offset }),
        options.store.listCreditPurchases(user.id, { limit, offset }),
      ]);

      res.set('Cache-Control', 'no-store');
      res.json({
        payments: payments.items.map(p => ({
          id: p.id,
          amountCents: p.amountCents,
          amountFormatted: formatMoney(p.amountCents),
          currency: p.currency,
          purpose: p.purpose,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
        creditPurchases: purchases.items.map(p => ({
          id: p.id,
          pack: p.pack,
          credits: p.credits,
          amountCents: p.amountCents,
          amountFormatted: formatMoney(p.amountCents),
          currency: p.currency,
          status: p.status,
          grantedAt: p.grantedAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
        })),
        totalPayments: payments.total,
        totalPurchases: purchases.total,
      });
    } catch (error) {
      res.status(500).json({ error: 'history_unavailable' });
    }
  });

  // ── Subscription cancellation ────────────────────────────────────────────────────────────

  router.post('/cancel', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const { immediate } = req.body as { immediate?: boolean };

      await options.billing.cancelSubscription({
        userId: user.id,
        cancelAtPeriodEnd: !immediate,
      });

      res.json({ success: true, message: immediate ? 'Subscription canceled immediately.' : 'Subscription will end at the current period.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancellation failed';
      res.status(500).json({ error: 'cancel_failed', message });
    }
  });

  // ── Invoices / receipts ──────────────────────────────────────────────────────────────────

  router.get('/invoices', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const payments = await options.store.listPayments(user.id, { limit, offset });

      // Generate Intake receipts for successful payments
      const invoices = payments.items
        .filter(p => p.status === 'succeeded')
        .map(p => ({
          id: p.id,
          referenceId: p.providerTransactionId ?? p.id,
          date: p.createdAt.toISOString(),
          description: invoiceDescription(p.purpose, p.metadata),
          amountCents: p.amountCents,
          amountFormatted: formatMoney(p.amountCents),
          currency: p.currency,
          status: p.status,
          provider: p.provider,
        }));

      res.set('Cache-Control', 'no-store');
      res.json({ invoices, total: invoices.length });
    } catch (error) {
      res.status(500).json({ error: 'invoices_unavailable' });
    }
  });

  return router;
}

// ── Bachs webhook route ────────────────────────────────────────────────────────────────────────

export function createBachsWebhookRouter(options: {
  billing: BillingService;
  paymentProvider: PaymentProvider;
}): Router {
  const router = Router();

  // Bachs webhooks must receive the raw body for signature verification.
  // This route must be mounted on an unparsed express route (no json middleware before it).
  router.post('/', express_rawJson(), async (req, res) => {
    const rawBody = (req as any).rawBody as string;
    const signature = req.headers['x-bachs-signature'] as string | undefined;

    // Verify webhook signature
    if (!options.paymentProvider.verifyWebhookSignature(rawBody, signature ?? '')) {
      return res.status(401).json({ error: 'invalid_signature' });
    }

    // Parse the event
    const event = options.paymentProvider.parseWebhookEvent(rawBody);
    if (!event) {
      return res.status(400).json({ error: 'invalid_event' });
    }

    try {
      const result = await options.billing.processWebhookEvent(event);
      if (result.duplicate) {
        // Idempotent replay — return success without reprocessing
        return res.json({ received: true, duplicate: true });
      }
      res.json({ received: true, processed: result.processed });
    } catch (error) {
      // Return 500 so Bachs retries the webhook
      return res.status(500).json({ error: 'processing_failed' });
    }
  });

  return router;
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

function invoiceDescription(purpose: string, metadata: Record<string, unknown>): string {
  switch (purpose) {
    case 'subscription': return 'Intake Pro subscription';
    case 'subscription_renewal': return 'Intake Pro subscription renewal';
    case 'credit_pack': return `Intake credit pack${metadata.pack ? ` (${metadata.pack})` : ''}`;
    default: return 'Intake billing';
  }
}

/**
 * Express middleware that captures the raw body before JSON parsing.
 * Bachs webhook signatures cover the raw bytes, so we must not alter the body.
 */
function express_rawJson() {
  return (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      (req as any).rawBody = raw;
      try {
        req.body = JSON.parse(raw);
      } catch {
        req.body = {};
      }
      next();
    });
    req.on('error', next);
  };
}
