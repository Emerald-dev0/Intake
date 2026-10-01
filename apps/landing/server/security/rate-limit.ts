import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import type { Request } from 'express';

/**
 * Technical abuse controls, not subscription or billing quotas. Subjects are keyed-HMACed before
 * storage so the limiter table does not become another source of user ids or network addresses.
 */
export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
}

export interface RateLimitStore {
  consume(scope: string, subject: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

export type AbuseScope =
  | 'oauth.start'
  | 'oauth.callback'
  | 'oauth.disconnect'
  | 'ai.interpret'
  | 'forms.create'
  | 'forms.provider_read'
  | 'forms.edit';

interface ScopePolicy {
  user: RateLimitRule;
  network: RateLimitRule;
}

/** Deliberately conservative operational ceilings. They do not represent a paid plan. */
export const ABUSE_POLICIES: Record<AbuseScope, ScopePolicy> = {
  // Network ceilings are deliberately much broader than user ceilings because a verified proxy
  // chain can still group many legitimate users behind one NAT or frontend egress address.
  'oauth.start': { user: { limit: 8, windowSeconds: 600 }, network: { limit: 800, windowSeconds: 600 } },
  'oauth.callback': { user: { limit: 20, windowSeconds: 600 }, network: { limit: 2_000, windowSeconds: 600 } },
  'oauth.disconnect': { user: { limit: 20, windowSeconds: 600 }, network: { limit: 2_000, windowSeconds: 600 } },
  'ai.interpret': { user: { limit: 8, windowSeconds: 600 }, network: { limit: 800, windowSeconds: 600 } },
  'forms.create': { user: { limit: 12, windowSeconds: 600 }, network: { limit: 1_200, windowSeconds: 600 } },
  'forms.provider_read': { user: { limit: 30, windowSeconds: 600 }, network: { limit: 3_000, windowSeconds: 600 } },
  'forms.edit': { user: { limit: 20, windowSeconds: 600 }, network: { limit: 2_000, windowSeconds: 600 } },
};

export type RequestLimitResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; reason: 'unavailable' };

function validRule(rule: RateLimitRule): void {
  if (!Number.isSafeInteger(rule.limit) || rule.limit < 1 || rule.limit > 100_000 ||
      !Number.isSafeInteger(rule.windowSeconds) || rule.windowSeconds < 1 || rule.windowSeconds > 86_400) {
    throw new Error('Invalid rate-limit rule');
  }
}

function subjectHash(subject: string, key: string): string {
  return createHmac('sha256', key).update(`intake-rate-limit:v1:${subject}`).digest('hex');
}

/**
 * Neon/PostgreSQL-backed fixed-window limiter. The UPSERT is the cross-process atomic boundary.
 * A process-local limiter is still useful for in-flight suppression, but is not treated as a
 * distributed quota.
 */
export function createPostgresRateLimitStore(pool: Pool, hashKey: string): RateLimitStore {
  if (hashKey.length < 32) throw new Error('Rate-limit hash key must be at least 32 characters');
  let calls = 0;
  return {
    async consume(scope, subject, rule) {
      validRule(rule);
      if (!/^[a-z][a-z0-9._-]{1,79}$/.test(scope) || !subject || subject.length > 512) {
        throw new Error('Invalid rate-limit key');
      }

      calls += 1;
      if (calls % 128 === 0) {
        await pool.query(`DELETE FROM api_rate_limit WHERE expires_at < clock_timestamp() - interval '1 day'`);
      }

      const result = await pool.query<{ request_count: number; retry_after_seconds: number }>(
        `WITH clock AS (
           SELECT clock_timestamp() AS now_at
         ), consumed AS (
           INSERT INTO api_rate_limit (scope, subject_hash, window_start, request_count, expires_at)
           SELECT $1, $2,
             to_timestamp(floor(extract(epoch FROM now_at) / $3::integer) * $3::integer),
             1,
             to_timestamp((floor(extract(epoch FROM now_at) / $3::integer) + 1) * $3::integer)
           FROM clock
           ON CONFLICT (scope, subject_hash, window_start)
           DO UPDATE SET request_count = api_rate_limit.request_count + 1
           RETURNING request_count, expires_at
         )
         SELECT request_count,
           GREATEST(1, CEIL(extract(epoch FROM (expires_at - clock_timestamp()))))::integer AS retry_after_seconds
         FROM consumed`,
        [scope, subjectHash(subject, hashKey), rule.windowSeconds],
      );
      const count = result.rows[0]?.request_count;
      const retryAfterSeconds = result.rows[0]?.retry_after_seconds;
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(retryAfterSeconds)) throw new Error('Rate-limit storage returned an invalid result');
      return {
        allowed: count <= rule.limit,
        retryAfterSeconds,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - count),
      };
    },
  };
}

/** Test/local double with the same fixed-window semantics. */
export function createMemoryRateLimitStore(now: () => number = Date.now, hashKey = 'intake-memory-rate-limit-test-key'): RateLimitStore {
  const buckets = new Map<string, { start: number; count: number }>();
  return {
    async consume(scope, subject, rule) {
      validRule(rule);
      const at = now();
      const windowMs = rule.windowSeconds * 1000;
      const start = Math.floor(at / windowMs) * windowMs;
      const key = `${scope}:${subjectHash(subject, hashKey)}`;
      const previous = buckets.get(key);
      const bucket = !previous || previous.start !== start ? { start, count: 0 } : previous;
      bucket.count += 1;
      buckets.set(key, bucket);
      return {
        allowed: bucket.count <= rule.limit,
        retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - at) / 1000)),
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - bucket.count),
      };
    },
  };
}

/** Express derives req.ip only from the configured trust-proxy boundary; forwarded headers are not read here. */
export function requestNetworkSubject(req: Request): string {
  const value = typeof req.ip === 'string' && req.ip ? req.ip : req.socket.remoteAddress || 'unknown';
  return value.replace(/[^A-Fa-f0-9:.[\]_-]/g, '').slice(0, 80) || 'unknown';
}

export async function consumeRequestLimit(
  store: RateLimitStore | undefined,
  scope: AbuseScope,
  userId: string,
  req: Request,
): Promise<RequestLimitResult> {
  if (!store) return { ok: true };
  const policy = ABUSE_POLICIES[scope];
  try {
    // Check the narrower subject first. Once a user is over limit, repeated denied requests must not
    // consume the broader network bucket and deny service to unrelated users behind the same proxy.
    const user = await store.consume(`${scope}.user`, `user:${userId}`, policy.user);
    if (!user.allowed) return { ok: false, reason: 'rate_limited', retryAfterSeconds: Math.max(1, user.retryAfterSeconds) };
    const network = await store.consume(`${scope}.network`, `network:${requestNetworkSubject(req)}`, policy.network);
    if (network.allowed) return { ok: true };
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: Math.max(1, network.retryAfterSeconds) };
  } catch {
    // Expensive operations fail closed if their distributed limiter cannot make a decision.
    return { ok: false, reason: 'unavailable' };
  }
}

export function setRateLimitHeaders(headers: { set(name: string, value: string): unknown }, retryAfterSeconds: number): void {
  headers.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterSeconds))));
}
