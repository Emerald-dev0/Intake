import { createHmac } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { emailUserMessage } from './errors';
import type { EmailLogger } from './logging';
import { createEmailLogger } from './logging';
import type { EmailNotifier } from './notifications';
import type { OtpService } from './otp';
import type { EmailConfig } from './config';
import type { EmailService } from './service';
import type { SessionUser } from '../providers/service';
import {
  consumeRequestLimit, requestNetworkSubject, setRateLimitHeaders, type AbuseScope, type RateLimitStore,
} from '../security/rate-limit';

/**
 * Account email routes.
 *
 * Everything here is server-authorised: the recipient address comes from the session or from a
 * rate-limited lookup, never from the request body. A client cannot choose who receives an Intake
 * email, which template is used, or which provider sends it (mission §31).
 */

export interface AccountEmailRouterDeps {
  emails: EmailService;
  otp: OtpService;
  notifier: EmailNotifier;
  config: EmailConfig;
  getSession: (req: Request) => Promise<SessionUser | null>;
  /** Server-side user directory; the source of truth for the address an email goes to. */
  users: {
    getById(userId: string): Promise<{ id: string; name: string | null; email: string; emailVerified: boolean } | null>;
    setEmailVerified(userId: string): Promise<void>;
    setEmail(userId: string, email: string): Promise<void>;
  };
  /** Better Auth password reset; Intake owns the rate limit and the email, Better Auth the token. */
  requestPasswordReset: (email: string) => Promise<void>;
  abuseLimiter?: RateLimitStore;
  /** Keyed HMAC of network subjects, matching the rate-limiter's privacy convention. */
  hashKey: string;
  now?: () => Date;
  log?: EmailLogger;
}

/**
 * Every handler here awaits the database, the OTP service and Calder. A rejected promise must
 * become a 500 through Express, not an unhandled rejection that takes the process down.
 */
function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

function stringValue(value: unknown, max = 320): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function createAccountEmailRouter(deps: AccountEmailRouterDeps): Router {
  const router = Router();
  const log = deps.log ?? createEmailLogger();
  // Small, strict per-route parsers: an email request is a code or an address, never a document.
  const json = express.json({ limit: '16kb', strict: true });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  async function session(req: Request, res: Response): Promise<SessionUser | null> {
    try {
      const user = await deps.getSession(req);
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return null;
      }
      return user;
    } catch {
      res.status(503).json({ error: 'Session temporarily unavailable' });
      return null;
    }
  }

  /** Unauthenticated routes are limited by network and by a hash of the submitted address. */
  async function allowAnonymous(req: Request, res: Response, scope: AbuseScope, email?: string): Promise<boolean> {
    const store = deps.abuseLimiter;
    if (!store) return true;
    const policy = { limit: 5, windowSeconds: 600 };
    try {
      const network = await store.consume(`${scope}.network`, `network:${requestNetworkSubject(req)}`, { limit: 40, windowSeconds: 600 });
      if (!network.allowed) {
        setRateLimitHeaders(res, network.retryAfterSeconds);
        res.status(429).json({ error: 'Too many requests. Wait a few minutes and try again.' });
        return false;
      }
      if (email) {
        const subject = createHmac('sha256', deps.hashKey).update(`intake-email:v1:${email.toLowerCase()}`).digest('hex');
        const account = await store.consume(`${scope}.address`, `address:${subject}`, policy);
        if (!account.allowed) {
          setRateLimitHeaders(res, account.retryAfterSeconds);
          res.status(429).json({ error: 'Too many requests for this address. Wait a few minutes and try again.' });
          return false;
        }
      }
      return true;
    } catch {
      res.status(503).json({ error: 'Rate limiting is temporarily unavailable.' });
      return false;
    }
  }

  async function allowSignedIn(req: Request, res: Response, userId: string, scope: AbuseScope): Promise<boolean> {
    const decision = await consumeRequestLimit(deps.abuseLimiter, scope, userId, req);
    if (decision.ok) return true;
    if (decision.reason === 'rate_limited') {
      setRateLimitHeaders(res, decision.retryAfterSeconds);
      res.status(429).json({ error: 'Too many requests. Wait a few minutes and try again.' });
    } else {
      res.status(503).json({ error: 'Rate limiting is temporarily unavailable.' });
    }
    return false;
  }

  /**
   * Public capability hint, mounted before any session check so the sign-up journey knows whether a
   * verification email can actually be delivered. Booleans only: no provider, no address, no key.
   */
  router.get('/config', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      deliveryConfigured: deps.config.configured,
      // Verification is only a gate where Intake can prove delivery; otherwise sign-up stays open.
      verificationRequired: deps.config.configured,
    });
  });

  router.get('/status', asyncRoute(async (req, res) => {
    const user = await session(req, res);
    if (!user) return;
    const record = await deps.users.getById(user.id).catch(() => null);
    res.json({
      deliveryConfigured: deps.config.configured,
      emailVerified: record?.emailVerified ?? false,
      email: record?.email ?? user.email,
    });
  }));

  // ── Verification ─────────────────────────────────────────────────────────────────────────────

  router.post('/verify', json, asyncRoute(async (req: Request, res: Response) => {
    const user = await session(req, res);
    if (!user) return;
    if (!await allowSignedIn(req, res, user.id, 'email.verify.send')) return;
    const record = await deps.users.getById(user.id).catch(() => null);
    if (!record) return res.status(401).json({ error: 'Not authenticated' });
    if (record.emailVerified) return res.json({ status: 'already_verified' });

    const result = await deps.otp.start({
      userId: user.id,
      email: record.email,
      purpose: 'verify_email',
      userName: record.name,
    });
    if (result.status === 'cooldown' || result.status === 'send_limit') {
      setRateLimitHeaders(res, result.retryAfterSeconds);
      return res.status(429).json({
        status: result.status,
        error: 'Please wait before requesting another code.',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    if (result.status === 'delivery_failed') {
      return res.status(result.retryable ? 503 : 502).json({
        status: 'delivery_failed',
        error: deps.config.configured
          ? 'Intake could not send the verification email. Try again shortly.'
          : 'Email delivery is not configured on this Intake server.',
      });
    }
    return res.json({ status: 'sent', expiresAt: result.expiresAt.toISOString(), expiresInSeconds: result.expiresInSeconds });
  }));

  router.post('/verify/confirm', json, asyncRoute(async (req: Request, res) => {
    const user = await session(req, res);
    if (!user) return;
    if (!await allowSignedIn(req, res, user.id, 'email.verify.confirm')) return;
    const code = stringValue((req.body as { code?: unknown } | undefined)?.code, 16);
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit code from your email.' });

    const result = await deps.otp.verify({ userId: user.id, purpose: 'verify_email', code });
    if (result.status === 'verified') {
      await deps.users.setEmailVerified(user.id);
      // The milestone that earns a welcome email is verification, not signup (mission §11).
      await deps.notifier.welcome(user.id).catch(() => undefined);
      return res.json({ status: 'verified' });
    }
    if (result.status === 'invalid') return res.status(400).json({ error: `That code is not correct. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.` });
    if (result.status === 'locked') return res.status(429).json({ error: 'Too many incorrect codes. Request a new one.' });
    if (result.status === 'expired') return res.status(410).json({ error: 'That code has expired. Request a new one.' });
    return res.status(400).json({ error: 'Request a new code to continue.' });
  }));

  // ── Email change ─────────────────────────────────────────────────────────────────────────────

  router.post('/change', json, asyncRoute(async (req: Request, res: Response) => {
    const user = await session(req, res);
    if (!user) return;
    if (!await allowSignedIn(req, res, user.id, 'email.change.send')) return;
    const newEmail = stringValue((req.body as { email?: unknown } | undefined)?.email).toLowerCase();
    const record = await deps.users.getById(user.id).catch(() => null);
    if (!record) return res.status(401).json({ error: 'Not authenticated' });
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/.test(newEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (newEmail === record.email.toLowerCase()) {
      return res.status(400).json({ error: 'That is already the email on this account.' });
    }

    const result = await deps.otp.start({
      userId: user.id, email: newEmail, purpose: 'email_change', userName: record.name,
    });
    if (result.status === 'cooldown' || result.status === 'send_limit') {
      setRateLimitHeaders(res, result.retryAfterSeconds);
      return res.status(429).json({ status: result.status, error: 'Please wait before requesting another code.', retryAfterSeconds: result.retryAfterSeconds });
    }
    if (result.status === 'delivery_failed') {
      return res.status(result.retryable ? 503 : 502).json({ status: 'delivery_failed', error: 'Intake could not send the verification email. Try again shortly.' });
    }
    return res.json({ status: 'sent', expiresAt: result.expiresAt.toISOString() });
  }));

  router.post('/change/confirm', json, asyncRoute(async (req: Request, res: Response) => {
    const user = await session(req, res);
    if (!user) return;
    if (!await allowSignedIn(req, res, user.id, 'email.change.confirm')) return;
    const code = stringValue((req.body as { code?: unknown } | undefined)?.code, 16);
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit code from your email.' });

    const record = await deps.users.getById(user.id).catch(() => null);
    if (!record) return res.status(401).json({ error: 'Not authenticated' });
    const result = await deps.otp.verify({ userId: user.id, purpose: 'email_change', code });
    if (result.status !== 'verified') {
      if (result.status === 'invalid') return res.status(400).json({ error: `That code is not correct. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.` });
      if (result.status === 'locked') return res.status(429).json({ error: 'Too many incorrect codes. Request a new one.' });
      if (result.status === 'expired') return res.status(410).json({ error: 'That code has expired. Request a new one.' });
      return res.status(400).json({ error: 'Request a new code to continue.' });
    }

    await deps.users.setEmail(user.id, result.email);
    await deps.notifier.emailChanged(user.id, record.email, result.email).catch(() => undefined);
    log('email.address.changed', { userId: user.id, reason: 'email_change' });
    return res.json({ status: 'changed', email: result.email });
  }));

  // ── Password reset ───────────────────────────────────────────────────────────────────────────

  /**
   * Always answers 202. Whether an account exists is not disclosed, and the reset email is only
   * produced by Better Auth when one does. The token is generated, stored, hashed, expired and
   * invalidated by Better Auth; Intake owns the rate limit and the delivery (mission §10).
   */
  router.post('/password/reset', json, asyncRoute(async (req: Request, res: Response) => {
    const email = stringValue((req.body as { email?: unknown } | undefined)?.email).toLowerCase();
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!await allowAnonymous(req, res, 'email.password_reset', email)) return;
    try {
      await deps.requestPasswordReset(email);
      log('email.password_reset.requested', { requested: true });
    } catch (error) {
      log('email.password_reset.rejected', { reason: error instanceof Error ? error.message : 'unknown' });
    }
    return res.status(202).json({ status: 'accepted' });
  }));

  return router;
}

/** Maps an internal email failure onto a sentence a signed-in user can act on. */
export function publicEmailErrorMessage(code: string): string {
  return emailUserMessage(code as Parameters<typeof emailUserMessage>[0]);
}
