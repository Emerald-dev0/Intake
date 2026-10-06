import { randomUUID } from 'node:crypto';
import { EmailError } from '../errors';
import type { EmailConfig } from '../config';
import type { EmailMessage, EmailProvider, EmailStatusSnapshot, ProviderSendResult } from '../types';

/**
 * The Calder adapter.
 *
 * This is the ONLY file in Intake that knows Calder's HTTP API. Everything above it speaks
 * `EmailMessage`; everything below it is an HTTP call to `POST /v1/emails`.
 *
 * Contract notes (verified against the Calder repository, apps/api/src/routes/emails.ts and
 * packages/validation/src/index.ts):
 *
 *   POST {baseUrl}/v1/emails
 *   Authorization: Bearer calder_sk_live_… | calder_sk_test_…
 *   Idempotency-Key: <deterministic business key>
 *   body: { from, to, subject, html, text, reply_to?, stream?, tags?, metadata?, template?, variables? }
 *   202 { id, status: "queued", message }          — accepted for delivery
 *   200 { …same… }                                  — idempotent replay, nothing new was queued
 *   409 { error: { code: "idempotency_conflict" } } — first request still in flight
 *
 * A 202 means "Calder accepted and queued this", NOT "a human can read it". Delivery is confirmed
 * by the `email.delivered` webhook (mission §23).
 */

const USER_AGENT = 'Intake-Email/1.0 (+https://intake.example.com)';

export interface CalderProviderOptions {
  config: EmailConfig;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Bounded jitter so retries never synchronise into a thundering herd. */
  random?: () => number;
}

interface CalderErrorBody {
  error?: { code?: string; message?: string };
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as CalderErrorBody).error;
    if (error && typeof error.message === 'string' && error.message) return error.message;
  }
  return fallback;
}

function errorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const code = (body as CalderErrorBody).error?.code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** Bounded exponential backoff with jitter: 250ms, 500ms, 1000ms … capped at 2s. */
function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(2_000, 250 * 2 ** (attempt - 1));
  return Math.round(base * (0.7 + random() * 0.6));
}

/** Honour Retry-After without ever letting a hostile header stall a request for long. */
function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(5_000, Math.round(seconds * 1_000));
}

export function createCalderProvider(options: CalderProviderOptions): EmailProvider {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${config.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      // AbortError is our own timeout: report it as a timeout, not as an opaque network error.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmailError('email_timeout', `Calder did not respond within ${timeoutMs} ms.`, { retryable: true });
      }
      throw new EmailError('email_provider_unavailable', 'Calder could not be reached.', { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(message: EmailMessage): Promise<ProviderSendResult> {
    // A sender identity id (`sender_…`) is a complete sender on its own, so an address is only
    // required when no id is configured.
    if (!config.apiKey || !(config.senderId || config.fromEmail)) {
      throw new EmailError('email_provider_not_configured', 'Calder is not configured on this server.');
    }
    const body: Record<string, unknown> = {
      from: config.senderId || config.fromEmail,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // Intake only ever sends transactional mail in this phase (mission §24).
      stream: message.stream,
    };
    if (message.replyTo ?? config.replyTo) body.reply_to = message.replyTo ?? config.replyTo;
    if (message.tags?.length) body.tags = message.tags;
    if (message.metadata) body.metadata = message.metadata;
    // Opt-in only: when a deployment manages copy in Calder's dashboard, send the alias plus the
    // variables that template needs. Intake's own rendered html/text are still sent, so a missing
    // or unpublished template can never stop an authentication email.
    if (message.template) {
      body.template = message.template;
      body.variables = message.variables ?? {};
    }

    const started = now();
    let attempts = 0;
    let lastError: EmailError | null = null;

    while (attempts < config.maxAttempts) {
      attempts += 1;
      let response: Response;
      try {
        response = await request('/v1/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': message.idempotencyKey,
            'user-agent': USER_AGENT,
          },
          body: JSON.stringify(body),
        }, config.timeoutMs);
      } catch (error) {
        lastError = error instanceof EmailError ? error : new EmailError('email_provider_unavailable', 'Calder request failed.', { retryable: true });
        if (lastError.retryable && attempts < config.maxAttempts) await sleep(backoffMs(attempts, random));
        continue;
      }

      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (response.status === 200 || response.status === 202) {
        const id = parsed && typeof parsed === 'object' && 'id' in parsed ? String((parsed as { id: unknown }).id) : '';
        if (!id) throw new EmailError('email_internal_error', 'Calder accepted the email but returned no id.', { providerStatus: response.status });
        const status = parsed && typeof parsed === 'object' && 'status' in parsed ? String((parsed as { status: unknown }).status) : 'queued';
        return {
          providerMessageId: id,
          status,
          replayed: response.status === 200,
          latencyMs: Math.max(0, now() - started),
          attempts,
        };
      }

      const code = errorCode(parsed);
      const mapped = mapStatusToError(response.status, code, errorMessage(parsed, `Calder returned HTTP ${response.status}`));
      lastError = mapped;
      // Only transient failures are retried. Validation, authentication, suppression, quota and
      // sender problems are terminal: retrying them would just burn the quota and delay the truth.
      if (!mapped.retryable) throw mapped;
      if (attempts < config.maxAttempts) {
        const pause = retryAfterMs(response) ?? backoffMs(attempts, random);
        await sleep(pause);
      }
    }

    throw lastError ?? new EmailError('email_provider_unavailable', 'Calder request did not complete.');
  }

  async function getStatus(providerMessageId: string): Promise<EmailStatusSnapshot | null> {
    if (!providerMessageId.startsWith('em_')) return null;
    const response = await request(
      `/v1/emails/${encodeURIComponent(providerMessageId)}`,
      { method: 'GET', headers: { authorization: `Bearer ${config.apiKey}`, 'user-agent': USER_AGENT } },
      config.timeoutMs,
    ).catch(() => null);
    if (!response?.ok) return null;
    const payload = await response.json().catch(() => null) as { data?: Record<string, unknown> } | null;
    const data = payload?.data;
    if (!data || typeof data.status !== 'string') return null;
    return {
      providerMessageId,
      status: data.status,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    };
  }

  return { id: 'calder', send, getStatus };
}

/**
 * Maps a Calder failure onto Intake's taxonomy.
 *
 * Order matters: a machine-readable code always outranks the bare HTTP status. A quota exhaustion or
 * an unverified sender arriving on a 429/403 is a permanent condition; retrying it would burn the
 * allowance and delay an honest failure. Only genuinely transient conditions come back retryable.
 */
function mapStatusToError(status: number, code: string | undefined, message: string): EmailError {
  switch (code) {
    case 'organization_sending_unavailable':
      return new EmailError('email_provider_unavailable', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'plan_limit_reached':
      return new EmailError('email_quota_exceeded', message, { providerStatus: status, providerCode: code });
    case 'domain_not_verified':
    case 'sender_not_ready':
      return new EmailError('email_sender_not_verified', message, { providerStatus: status, providerCode: code });
    case 'suppressed':
      return new EmailError('email_suppressed', message, { providerStatus: status, providerCode: code });
    case 'idempotency_conflict':
    case 'conflict':
      return new EmailError('email_idempotency_conflict', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'authentication_error':
    case 'authorization_error':
      return new EmailError('email_provider_authentication_failed', message, { providerStatus: status, providerCode: code });
    case 'rate_limit_error':
      return new EmailError('email_provider_rate_limited', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'validation_error':
      return /recipient|to\b/i.test(message)
        ? new EmailError('email_invalid_recipient', message, { providerStatus: status, providerCode: code })
        : new EmailError('email_validation_error', message, { providerStatus: status, providerCode: code });
    case 'not_found':
      return new EmailError('email_template_error', message, { providerStatus: status, providerCode: code });
    default:
      break;
  }
  if (status === 409) {
    return new EmailError('email_idempotency_conflict', message, { retryable: true, providerStatus: status, providerCode: code ?? null });
  }
  if (status === 422) {
    return new EmailError('email_validation_error', message, { providerStatus: status, providerCode: code ?? null });
  }
  if (status === 404) {
    return new EmailError('email_template_error', message, { providerStatus: status, providerCode: code ?? null });
  }
  if (status === 429) {
    return new EmailError('email_provider_rate_limited', message, { retryable: true, providerStatus: status, providerCode: code ?? null });
  }
  if (status === 400) {
    return new EmailError('email_validation_error', message, { providerStatus: status, providerCode: code ?? null });
  }
  if (status === 401 || status === 403) {
    return new EmailError('email_provider_authentication_failed', message, { providerStatus: status, providerCode: code ?? null });
  }
  if (status >= 500) {
    return new EmailError('email_provider_unavailable', message, { retryable: true, providerStatus: status, providerCode: code ?? null });
  }
  return new EmailError('email_provider_unavailable', message, { providerStatus: status, providerCode: code ?? null });
}

/** Test/local provider: records messages in memory and can simulate every failure class. */
export interface MemoryEmailProvider extends EmailProvider {
  readonly sent: Array<EmailMessage & { result: ProviderSendResult }>;
  failWith(error: EmailError | null): void;
  failTimes(count: number, error: EmailError): void;
  clear(): void;
}

export function createMemoryEmailProvider(options: { id?: string; now?: () => number } = {}): MemoryEmailProvider {
  const sent: Array<EmailMessage & { result: ProviderSendResult }> = [];
  const id = options.id ?? 'memory';
  const now = options.now ?? (() => Date.now());
  let forced: EmailError | null = null;
  let remainingFailures = 0;
  let sequence = 0;
  return {
    id,
    sent,
    clear() {
      sent.length = 0;
      forced = null;
      remainingFailures = 0;
    },
    failWith(error) {
      forced = error;
    },
    failTimes(count, error) {
      remainingFailures = count;
      forced = error;
    },
    async send(message) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw forced ?? new EmailError('email_provider_unavailable', 'simulated failure', { retryable: true });
      }
      if (forced) throw forced;
      sequence += 1;
      const result: ProviderSendResult = {
        providerMessageId: `em_memory_${randomUUID().replace(/-/g, '').slice(0, 20)}${sequence}`,
        status: 'queued',
        replayed: false,
        latencyMs: 1,
        attempts: 1,
      };
      sent.push({ ...message, result });
      return result;
    },
    async getStatus(providerMessageId) {
      return { providerMessageId, status: 'queued', updatedAt: new Date(now()).toISOString() };
    },
  };
}
