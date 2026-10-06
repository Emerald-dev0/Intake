import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { EmailLogger } from './logging';
import { createEmailLogger } from './logging';
import type { EmailService } from './service';
import type { EmailType } from './types';

/**
 * Email verification codes (OTP).
 *
 * Intake owns every part of this: generation, hashing, storage, expiry, attempt limits, resend
 * limits, verification and invalidation. Calder only ever carries the rendered email, and no model
 * is involved anywhere in the authentication path (mission §9, §25).
 *
 * State lives in Better Auth's `verification` table so there is one authentication system, not two.
 * Raw codes are never persisted and never logged: only a keyed HMAC with a per-challenge salt.
 */

export type OtpPurpose = 'verify_email' | 'email_change';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;

export interface OtpChallenge {
  challengeId: string;
  userId: string;
  email: string;
  purpose: OtpPurpose;
  /** `salt:hmac` — the code itself is never stored. */
  proof: string;
  attempts: number;
  sends: number;
  createdAt: number;
  lastSentAt: number;
  expiresAt: number;
}

export interface OtpStore {
  put(challenge: OtpChallenge): Promise<void>;
  get(userId: string, purpose: OtpPurpose): Promise<OtpChallenge | null>;
  remove(userId: string, purpose: OtpPurpose): Promise<void>;
}

export type OtpStartResult =
  | { status: 'sent'; challengeId: string; expiresAt: Date; expiresInSeconds: number }
  | { status: 'cooldown'; retryAfterSeconds: number }
  | { status: 'send_limit'; retryAfterSeconds: number }
  | { status: 'delivery_failed'; retryable: boolean };

export type OtpVerifyResult =
  | { status: 'verified'; email: string }
  | { status: 'invalid'; attemptsRemaining: number }
  | { status: 'expired' }
  | { status: 'locked' }
  | { status: 'missing' }
  | { status: 'rate_limited' };

export interface OtpServiceOptions {
  store: OtpStore;
  emails: EmailService;
  /** Server secret used to key the code HMAC. Rotate it and outstanding codes simply expire. */
  hashKey: string;
  now?: () => Date;
  newId?: () => string;
  log?: EmailLogger;
  ttlSeconds?: number;
  maxAttempts?: number;
  resendCooldownSeconds?: number;
  maxSendsPerHour?: number;
}

function newCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

function proofFor(code: string, salt: string, hashKey: string): string {
  return `${salt}:${createHmac('sha256', hashKey).update(`${salt}.${code}`).digest('hex')}`;
}

function matches(proof: string, code: string, hashKey: string): boolean {
  const [salt, expected] = proof.split(':');
  if (!salt || !expected) return false;
  const actual = createHmac('sha256', hashKey).update(`${salt}.${code}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createOtpService(options: OtpServiceOptions) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `otp_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  const log = options.log ?? createEmailLogger();
  const ttlSeconds = options.ttlSeconds ?? OTP_TTL_SECONDS;
  const maxAttempts = options.maxAttempts ?? OTP_MAX_ATTEMPTS;
  const resendCooldownSeconds = options.resendCooldownSeconds ?? OTP_RESEND_COOLDOWN_SECONDS;
  const maxSendsPerHour = options.maxSendsPerHour ?? OTP_MAX_SENDS_PER_HOUR;
  if (options.hashKey.length < 32) throw new Error('OTP hash key must be at least 32 characters');

  async function start(input: {
    userId: string; email: string; purpose: OtpPurpose; userName?: string | null; eventId?: string;
  }): Promise<OtpStartResult> {
    const at = now();
    const email = input.email.trim().toLowerCase();
    const existing = await options.store.get(input.userId, input.purpose);

    // Resend windows are enforced server-side; the route's rate limiter is the network-level second
    // line. A fresh code always replaces the previous one, so only one code is ever valid.
    if (existing) {
      const since = (at.getTime() - existing.lastSentAt) / 1000;
      if (since < resendCooldownSeconds) {
        log('email.otp.rate_limited', { userId: input.userId, purpose: input.purpose, reason: 'cooldown' });
        return { status: 'cooldown', retryAfterSeconds: Math.max(1, Math.ceil(resendCooldownSeconds - since)) };
      }
      if (existing.sends >= maxSendsPerHour && at.getTime() - existing.createdAt < 3_600_000) {
        const retryAfterSeconds = Math.max(1, Math.ceil((existing.createdAt + 3_600_000 - at.getTime()) / 1000));
        log('email.otp.rate_limited', { userId: input.userId, purpose: input.purpose, reason: 'hourly' });
        return { status: 'send_limit', retryAfterSeconds };
      }
    }

    const code = newCode();
    const salt = randomUUID();
    const challengeId = newId();
    const expiresAt = at.getTime() + ttlSeconds * 1000;
    const challenge: OtpChallenge = {
      challengeId,
      userId: input.userId,
      email,
      purpose: input.purpose,
      proof: proofFor(code, salt, options.hashKey),
      attempts: 0,
      sends: (existing?.sends ?? 0) + 1,
      createdAt: existing && at.getTime() - existing.createdAt < 3_600_000 ? existing.createdAt : at.getTime(),
      lastSentAt: at.getTime(),
      expiresAt,
    };

    const outcome = await options.emails.send({
      type: 'otp' satisfies EmailType,
      to: email,
      // Idempotency is bound to the challenge, so a retry after a network blip can never produce a
      // second email with a second code (mission §8).
      eventId: input.eventId ?? challengeId,
      userId: input.userId,
      variables: {
        otpCode: code,
        expiryMinutes: String(Math.round(ttlSeconds / 60)),
        purpose: input.purpose,
        userName: input.userName ?? '',
      },
      tags: [{ name: 'purpose', value: input.purpose }],
    });

    if (outcome.status === 'skipped' && outcome.reason === 'suppressed') {
      log('email.otp.rate_limited', { userId: input.userId, purpose: input.purpose, reason: 'suppressed' });
      return { status: 'delivery_failed', retryable: false };
    }
    if (outcome.status === 'failed') {
      log('email.otp.rejected', { userId: input.userId, purpose: input.purpose, errorCode: outcome.errorCode });
      return { status: 'delivery_failed', retryable: outcome.retryable };
    }

    await options.store.put(challenge);
    log(existing ? 'email.otp.resent' : 'email.otp.started', {
      userId: input.userId, purpose: input.purpose, challengeId, sends: challenge.sends,
    });
    return { status: 'sent', challengeId, expiresAt: new Date(expiresAt), expiresInSeconds: ttlSeconds };
  }

  async function verify(input: { userId: string; purpose: OtpPurpose; code: string }): Promise<OtpVerifyResult> {
    const at = now();
    const challenge = await options.store.get(input.userId, input.purpose);
    if (!challenge) {
      log('email.otp.rejected', { userId: input.userId, purpose: input.purpose, reason: 'missing' });
      return { status: 'missing' };
    }
    if (at.getTime() > challenge.expiresAt) {
      await options.store.remove(input.userId, input.purpose);
      log('email.otp.rejected', { userId: input.userId, purpose: input.purpose, reason: 'expired' });
      return { status: 'expired' };
    }
    if (challenge.attempts >= maxAttempts) {
      await options.store.remove(input.userId, input.purpose);
      log('email.otp.rejected', { userId: input.userId, purpose: input.purpose, reason: 'locked' });
      return { status: 'locked' };
    }

    const code = (input.code ?? '').trim();
    if (!/^\d{6}$/.test(code) || !matches(challenge.proof, code, options.hashKey)) {
      const attempts = challenge.attempts + 1;
      await options.store.put({ ...challenge, attempts });
      log('email.otp.rejected', { userId: input.userId, purpose: input.purpose, reason: 'invalid', attempts });
      if (attempts >= maxAttempts) {
        await options.store.remove(input.userId, input.purpose);
        return { status: 'locked' };
      }
      return { status: 'invalid', attemptsRemaining: maxAttempts - attempts };
    }

    // Success is single-use: the challenge is destroyed before the caller is told it worked.
    await options.store.remove(input.userId, input.purpose);
    log('email.otp.verified', { userId: input.userId, purpose: input.purpose, challengeId: challenge.challengeId });
    return { status: 'verified', email: challenge.email };
  }

  return { start, verify, ttlSeconds, maxAttempts, resendCooldownSeconds };
}

export type OtpService = ReturnType<typeof createOtpService>;

// ── Storage ────────────────────────────────────────────────────────────────────────────────────

const IDENTIFIER_PREFIX = 'intake-otp';

function identifier(userId: string, purpose: OtpPurpose): string {
  return `${IDENTIFIER_PREFIX}:${purpose}:${userId}`;
}

function parse(value: string): OtpChallenge | null {
  try {
    const parsed = JSON.parse(value) as OtpChallenge;
    if (typeof parsed?.challengeId !== 'string' || typeof parsed?.proof !== 'string' || typeof parsed?.email !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Better Auth's `verification` table, reused rather than duplicated. Only Intake-owned identifiers
 * (`intake-otp:…`) are ever read or written here, so Better Auth's own rows are untouched.
 */
export function createPostgresOtpStore(pool: Pool): OtpStore {
  return {
    async put(challenge) {
      await pool.query(
        `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (identifier)
         DO UPDATE SET value = excluded.value, "expiresAt" = excluded."expiresAt", "updatedAt" = now()`,
        [challenge.challengeId, identifier(challenge.userId, challenge.purpose), JSON.stringify(challenge), new Date(challenge.expiresAt)],
      );
    },
    async get(userId, purpose) {
      const result = await pool.query<{ value: string; expiresAt: Date }>(
        'SELECT value, "expiresAt" FROM verification WHERE identifier = $1 LIMIT 1',
        [identifier(userId, purpose)],
      );
      const row = result.rows[0];
      if (!row) return null;
      // An expired row is cleaned up here but still returned: the service decides whether that means
      // "expired" or "missing", which is the distinction a user-facing message depends on.
      if (row.expiresAt.getTime() < Date.now()) {
        await pool.query('DELETE FROM verification WHERE identifier = $1', [identifier(userId, purpose)]);
      }
      return parse(row.value);
    },
    async remove(userId, purpose) {
      await pool.query('DELETE FROM verification WHERE identifier = $1', [identifier(userId, purpose)]);
    },
  };
}

export function createMemoryOtpStore(options: { now?: () => number } = {}): OtpStore & { challenges: Map<string, OtpChallenge> } {
  const challenges = new Map<string, OtpChallenge>();
  const now = options.now ?? (() => Date.now());
  return {
    challenges,
    async put(challenge) { challenges.set(identifier(challenge.userId, challenge.purpose), challenge); },
    async get(userId, purpose) {
      const challenge = challenges.get(identifier(userId, purpose)) ?? null;
      if (!challenge) return null;
      // Same contract as PostgreSQL: expired rows are dropped, but the caller still learns why.
      if (challenge.expiresAt < now()) {
        challenges.delete(identifier(userId, purpose));
      }
      return challenge;
    },
    async remove(userId, purpose) { challenges.delete(identifier(userId, purpose)); },
  };
}
