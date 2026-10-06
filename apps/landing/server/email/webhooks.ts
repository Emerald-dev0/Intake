import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { EmailConfig } from './config';
import type { EmailLogger } from './logging';
import { createEmailLogger } from './logging';
import type { EmailStore } from './types';

/**
 * Calder delivery webhooks.
 *
 * Signature scheme (Calder docs/API.md and apps/worker/src/webhook-consumer.ts):
 *
 *   webhook-id: <delivery id>
 *   webhook-signature: t=<unix seconds>,v1=<hex hmac-sha256>
 *   v1 = HMAC-SHA256(secret, `${t}.${rawBody}`)
 *
 * The body must be verified as raw bytes, before JSON parsing, and the timestamp bounds replays to
 * five minutes. Nothing in the payload is trusted until the signature checks out (mission §17).
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_BODY_BYTES = 64 * 1024;

export interface CalderWebhookEvent {
  id: string;
  type: string;
  createdAt?: string;
  data?: { emailId?: string; [key: string]: unknown };
}

export type WebhookRejection =
  | 'missing_signature'
  | 'malformed_signature'
  | 'stale_timestamp'
  | 'bad_signature'
  | 'invalid_payload';

export interface VerifyResult {
  ok: boolean;
  reason?: WebhookRejection;
}

/**
 * Timing-safe verification. `nowSeconds` is injected so replay windows are testable without clocks.
 */
export function verifyCalderSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): VerifyResult {
  if (!secret || !signatureHeader) return { ok: false, reason: 'missing_signature' };
  const parts = new Map<string, string>();
  for (const chunk of signatureHeader.split(',')) {
    const index = chunk.indexOf('=');
    if (index > 0) parts.set(chunk.slice(0, index).trim(), chunk.slice(index + 1).trim());
  }
  const t = parts.get('t');
  const v1 = parts.get('v1');
  if (!t || !v1) return { ok: false, reason: 'malformed_signature' };
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed_signature' };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(v1.toLowerCase(), 'utf8');
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

function parseEvent(body: string): CalderWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const event = parsed as Partial<CalderWebhookEvent>;
  if (typeof event.id !== 'string' || !event.id || typeof event.type !== 'string' || !event.type) return null;
  return event as CalderWebhookEvent;
}

/**
 * Maps a Calder lifecycle event onto Intake's delivery record and suppression state.
 *
 * Only a *hard* bounce suppresses. Calder's own SES consumer (`apps/api/src/lib/ses-events.ts`)
 * treats `bounceType === 'Permanent'` as hard and leaves transient bounces unsuppressed, because
 * suppressing a soft bounce punishes greylisting and full mailboxes. Intake follows the provider's
 * classification rather than inventing its own.
 */
function outcomeFor(type: string, data?: CalderWebhookEvent['data']): {
  status?: 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed_remote';
  suppress?: 'bounce' | 'complaint';
  transient?: boolean;
} {
  switch (type) {
    case 'email.queued': return { status: 'queued' };
    case 'email.sent': return { status: 'sent' };
    case 'email.delivered': return { status: 'delivered' };
    case 'email.bounced': {
      const hard = String(data?.bounceType ?? '').trim().toLowerCase() === 'permanent';
      return hard ? { status: 'bounced', suppress: 'bounce' } : { transient: true };
    }
    case 'email.complained': return { status: 'complained', suppress: 'complaint' };
    case 'email.failed': return { status: 'failed_remote' };
    // Engagement only: Calder's schema has no opened/clicked delivery status either.
    case 'email.opened':
    case 'email.clicked':
      return {};
    default:
      return {};
  }
}

/** States a delivery never walks backwards out of: a late `delivered` does not un-bounce an address. */
const TERMINAL_STATUSES = new Set(['bounced', 'complained', 'failed_remote']);

export interface WebhookDeps {
  store: EmailStore;
  config: EmailConfig;
  log?: EmailLogger;
  now?: () => Date;
}

export interface WebhookOutcome {
  status: number;
  body: { ok: boolean; duplicate?: boolean; ignored?: boolean; error?: string };
  reason?: WebhookRejection;
}

/**
 * Handles one delivery. Verified duplicates still answer 200: Calder retries for 24h and a
 * `204`-style "already seen" is how it learns to stop (mission §17).
 */
export async function handleCalderWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signatureHeader: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<WebhookOutcome> {
  const log = deps.log ?? createEmailLogger();
  const verification = verifyCalderSignature(rawBody, signatureHeader, deps.config.webhookSecret, nowSeconds);
  if (!verification.ok) {
    log('email.webhook.rejected', { reason: verification.reason });
    return { status: 401, body: { ok: false, error: 'Invalid signature.' }, reason: verification.reason };
  }

  const event = parseEvent(rawBody);
  if (!event) {
    log('email.webhook.rejected', { reason: 'invalid_payload' });
    return { status: 400, body: { ok: false, error: 'Invalid payload.' }, reason: 'invalid_payload' };
  }

  const emailId = typeof event.data?.emailId === 'string' ? event.data.emailId : null;
  const fresh = await deps.store.recordWebhookEvent(event.id, event.type, emailId);
  if (!fresh) {
    log('email.webhook.replay', { eventId: event.id, eventType: event.type });
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  log('email.webhook.received', { eventId: event.id, eventType: event.type, providerMessageId: emailId });

  const outcome = outcomeFor(event.type, event.data);
  if (!emailId) return { status: 200, body: { ok: true, ignored: true } };

  const delivery = await deps.store.findByProviderMessageId(emailId);
  if (!delivery) {
    log('email.webhook.unknown_message', { providerMessageId: emailId, eventType: event.type });
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (outcome.transient) {
    // Soft bounce: SES keeps retrying, so the address stays deliverable and the row stays as it was.
    log('email.webhook.transient_bounce', { providerMessageId: emailId, eventType: event.type });
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (outcome.status && !TERMINAL_STATUSES.has(delivery.status)) {
    await deps.store.updateDelivery(delivery.id, { status: outcome.status, lastEventAt: new Date() });
  }

  if (outcome.suppress) {
    await deps.store.suppress(delivery.recipient, outcome.suppress, `calder:${event.type}`);
    log('email.suppression.added', {
      recipient: delivery.recipient, reason: outcome.suppress, providerMessageId: emailId,
    });
  }

  return { status: 200, body: { ok: true } };
}

/** Express handler. Mounted on a raw-body route: the signature covers bytes, not a parsed object. */
export function calderWebhookHandler(deps: WebhookDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        break;
      }
      chunks.push(buffer);
    }
    if (aborted) {
      res.status(413).json({ ok: false, error: 'Webhook payload is too large.' });
      return;
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const header = req.get('webhook-signature') ?? undefined;
    const result = await handleCalderWebhook(deps, raw, header);
    res.status(result.status).json(result.body);
  };
}
