import express, { Router, type ErrorRequestHandler } from 'express';
import { isWaitlistEmail, normalizeWaitlistEmail } from '../../src/lib/waitlist';
import type { RateLimitStore } from '../security/rate-limit';
import { requestNetworkSubject, setRateLimitHeaders } from '../security/rate-limit';
import type { WaitlistStore } from './store';

export interface WaitlistRouterDeps {
  store: Pick<WaitlistStore, 'subscribe'>;
  rateLimiter: RateLimitStore;
  onJoin?: () => void;
}

/** Public signup only. Never exposes addresses, membership, or email-provider configuration. */
export function createWaitlistRouter(deps: WaitlistRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/', (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Please send your signup as JSON.' });
    // A cross-site browser must not be allowed to subscribe arbitrary addresses from another site.
    // Same-origin frontend proxies preserve the original Sec-Fetch-Site header.
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Please join from the Intake website.' });
    next();
  }, express.json({ limit: '4kb', strict: true }), (req, res, next) => {
    void (async () => {
      try {
        const decision = await deps.rateLimiter.consume(
          'waitlist.join.network', `network:${requestNetworkSubject(req)}`, { limit: 200, windowSeconds: 600 },
        );
        if (!decision.allowed) {
          setRateLimitHeaders(res, decision.retryAfterSeconds);
          res.status(429).json({ error: 'Too many attempts. Please wait a little and try again.' });
          return;
        }
      } catch {
        res.status(503).json({ error: 'The wait-list is temporarily unavailable. Please try again shortly.' });
        return;
      }
      const body = req.body as Record<string, unknown> | null;
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !['email', 'website'].includes(key)) ||
          (body.website !== undefined && typeof body.website !== 'string')) {
        res.status(400).json({ error: 'Enter a valid email address.' });
        return;
      }
      // Honeypot: deliberately indistinguishable from a successful human signup.
      if (typeof body.website === 'string' && body.website.trim()) {
        res.json({ status: 'joined' });
        return;
      }
      const email = typeof body.email === 'string' ? normalizeWaitlistEmail(body.email) : '';
      if (!isWaitlistEmail(email)) {
        res.status(400).json({ error: 'Enter a valid email address.' });
        return;
      }
      // Network buckets can be shared by a NAT or frontend-proxy egress. Keep that ceiling
      // broad, with a separate, keyed-HMAC recipient bucket to prevent targeted address abuse.
      try {
        const decision = await deps.rateLimiter.consume(
          'waitlist.join.email', `email:${email}`, { limit: 5, windowSeconds: 3600 },
        );
        if (!decision.allowed) {
          setRateLimitHeaders(res, decision.retryAfterSeconds);
          res.status(429).json({ error: 'Too many attempts. Please wait a little and try again.' });
          return;
        }
      } catch {
        res.status(503).json({ error: 'The wait-list is temporarily unavailable. Please try again shortly.' });
        return;
      }
      try {
        await deps.store.subscribe(email);
      } catch {
        res.status(503).json({ error: 'We couldn’t save your place. Please try again shortly.' });
        return;
      }
      // Save first; wake the durable queue only after success. Repeat signups keep the same event.
      res.json({ status: 'joined' });
      try { deps.onJoin?.(); } catch { /* The polling worker will recover a missed wakeup. */ }
    })().catch(next);
  });
  const bodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error?.status === 413 ? 413 : error?.status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Signup request is too large.' : status === 400 ? 'Signup request is invalid.' : 'The wait-list is temporarily unavailable.' });
  };
  router.use(bodyError);
  return router;
}
