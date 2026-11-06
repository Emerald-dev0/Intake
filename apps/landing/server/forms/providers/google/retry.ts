/**
 * Bounded retries for Google Forms reads.
 *
 * Reading responses is a quota spend, and Google answers a burst either slowly or with a 429. A
 * single transient failure should not lose a person's export, and it should not become an
 * afternoon of hammering either. So: a small number of attempts, a growing wait with jitter, and
 * an immediate stop on anything that will not improve by asking again.
 *
 * The two other backoff helpers in this repository (`server/ai/chat-completions.ts` and
 * `server/email/providers/calder.ts`) are private to their modules and tuned for their own
 * vendors; neither can be reused without changing unrelated code, so this one is small and local.
 */

import { GoogleFormsApiError } from './client';

export interface RetryOptions {
  /** Total attempts including the first. Two retries is three calls at most. */
  attempts?: number;
  /** Base wait. Doubles each attempt, capped at `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected so a test does not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const DEFAULTS = { attempts: 3, baseDelayMs: 400, maxDelayMs: 4000 };

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Whether asking again could plausibly work.
 *
 * A 429, a 5xx, a network blip and a timeout are all worth one more try. A 400, 401, 403 or 404 is
 * an answer: the request is wrong, the permission is missing, or the thing is not there. Retrying
 * those spends quota to be told the same thing.
 */
interface ApiErrorInfo {
  kind?: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
}

/**
 * The error details, for any Google client in this repository.
 *
 * Both the Forms and Sheets clients carry the same `info` shape, so retry policy lives in one place
 * rather than being reimplemented per vendor. The check is structural on purpose: importing the
 * Sheets error class here would make the shared helper depend on a client it is meant to be used by.
 */
function apiInfo(error: unknown): ApiErrorInfo | null {
  if (error instanceof GoogleFormsApiError) return error.info;
  if (error && typeof error === 'object' && 'info' in error) {
    const info = (error as { info?: unknown }).info;
    if (info && typeof info === 'object' && typeof (info as ApiErrorInfo).kind === 'string') return info as ApiErrorInfo;
  }
  return null;
}

export function isRetryable(error: unknown): boolean {
  const info = apiInfo(error);
  if (!info) return false;
  const { kind, httpStatus } = info;
  if (kind === 'network' || kind === 'timeout') return true;
  if (kind !== 'http') return false;
  return httpStatus === 429 || httpStatus === 408 || (typeof httpStatus === 'number' && httpStatus >= 500);
}

/** Wait before attempt `failed` (1 = the first attempt just failed). Honors Google's Retry-After. */
export function retryDelayMs(failed: number, retryAfterSeconds: number | undefined, options: RetryOptions = {}): number {
  const { baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options };
  const random = options.random ?? Math.random;
  // Google said how long. Believe it, within the bounds of a request a person is waiting on.
  if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, maxDelayMs!);
  }
  const exponential = Math.min(baseDelayMs! * 2 ** Math.max(0, failed - 1), maxDelayMs!);
  // Jitter, so several exports that failed together do not all come back together.
  return exponential + Math.floor(random() * 250);
}

/** Run `run`, retrying only what is worth retrying. The last real error is the one thrown. */
export async function withRetry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULTS.attempts);
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;
      const retryAfter = apiInfo(error)?.retryAfterSeconds;
      await sleep(retryDelayMs(attempt, retryAfter, options));
    }
  }
  throw lastError;
}
