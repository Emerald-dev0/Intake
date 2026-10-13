/**
 * Public update subscriptions: the Pro waitlist and the product-updates list.
 *
 * POST /api/updates/subscribe accepts an email address and an interest, stores
 * nothing else, and always answers the same way once the address is valid — so
 * the endpoint can never be used to probe which addresses already subscribed.
 * A `website` honeypot field absorbs naive bots: anything filled in is accepted
 * and silently dropped.
 */

import express, { Router } from 'express';
import type { RateLimitStore } from '../security/rate-limit';
import { requestNetworkSubject, setRateLimitHeaders } from '../security/rate-limit';
import type { UpdatesStore, UpdateInterest } from './store';

export interface UpdatesRouterDeps {
  store: UpdatesStore;
  rateLimiter?: RateLimitStore;
}

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/;
const INTERESTS: UpdateInterest[] = ['pro', 'updates'];

export function createUpdatesRouter(deps: UpdatesRouterDeps): Router {
  const router = Router();

  router.post('/subscribe', express.json({ limit: '4kb', strict: true }), (req, res, next) => {
    void (async () => {
      if (deps.rateLimiter) {
        try {
          const decision = await deps.rateLimiter.consume(
            'updates.subscribe.network', `network:${requestNetworkSubject(req)}`, { limit: 10, windowSeconds: 600 },
          );
          if (!decision.allowed) {
            setRateLimitHeaders(res, decision.retryAfterSeconds);
            res.status(429).json({ error: 'Too many requests. Wait briefly and try again.' });
            return;
          }
        } catch {
          res.status(503).json({ error: 'Subscriptions are temporarily unavailable.' });
          return;
        }
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Honeypot: a filled-in `website` field means a bot. Accept and drop.
      if (typeof body.website === 'string' && body.website.trim()) {
        res.json({ status: 'subscribed' });
        return;
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email) || email.length > 320) {
        res.status(400).json({ error: 'Enter a valid email address.' });
        return;
      }
      const interest: UpdateInterest = INTERESTS.includes(body.interest as UpdateInterest)
        ? (body.interest as UpdateInterest)
        : 'updates';
      try {
        await deps.store.subscribe(email, interest);
      } catch {
        res.status(503).json({ error: 'Subscriptions are temporarily unavailable.' });
        return;
      }
      res.json({ status: 'subscribed' });
    })().catch(next);
  });

  return router;
}
