import { randomUUID } from 'node:crypto';
import type { EmailConfig } from './config';
import { EmailError } from './errors';
import type { EmailSender } from './types';

/**
 * Types that are broadcast in principle. They still travel as `transactional` until the provider's
 * broadcast route exists — see the `stream` decision below and CALDER_BROADCAST_ENABLED.
 */
const LIST_STREAM_TYPES: ReadonlySet<string> = new Set(['admin_message', 'launch_announcement', 'launch_note']);
import { createEmailLogger, type EmailLogger } from './logging';
import { renderEmail, type EmailVariables } from './templates';
import { NULL_EMAIL_STORE } from './store';
import type {
  EmailMessage, EmailProvider, EmailSendOutcome, EmailStore, EmailStream, EmailType, SendEmailRequest,
} from './types';
import { maskEmail } from './types';

/**
 * The email service: the only way the rest of Intake sends mail.
 *
 * Application code says "a password changed for user X". This module decides the template, the
 * idempotency key, the suppression check and the delivery record, then hands a rendered message to
 * whichever provider is configured. Nothing above this line knows Calder exists (mission §37).
 */

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;
const MAX_RECIPIENT = 320;

export interface EmailServiceOptions {
  provider: EmailProvider | null;
  config: EmailConfig;
  store?: EmailStore;
  now?: () => Date;
  newId?: () => string;
  log?: EmailLogger;
}

export interface EmailService {
  readonly providerId: string;
  readonly configured: boolean;
  send(request: SendEmailRequest): Promise<EmailSendOutcome>;
  /** Reconciliation only: fetches provider truth for one accepted email. Never used to send. */
  status(providerMessageId: string): Promise<{ providerMessageId: string; status: string; updatedAt: string | null } | null>;
}

/** Deterministic idempotency keys. Same business event ⇒ same key, on every retry (mission §8). */
export function idempotencyKeyFor(type: EmailType, eventId: string): string {
  const slug = type.replace(/_/g, '-');
  return `intake:${slug}:${eventId}`.slice(0, 255);
}

/** Stable UTC phrasing for emails. Avoids locale surprises in a security notice. */
export function formatEmailTimestamp(at: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}

export function isValidRecipient(value: string): boolean {
  return typeof value === 'string' && value.length > 3 && value.length <= MAX_RECIPIENT && EMAIL.test(value);
}

/** Variables every template can rely on. Per-email variables are merged on top, never the reverse. */
export function baseVariables(config: EmailConfig, at: Date): EmailVariables {
  return {
    appName: 'Intake',
    timestamp: formatEmailTimestamp(at),
    dashboardUrl: `${config.appOrigin}/app`,
    securityUrl: `${config.appOrigin}/app/account`,
    connectionsUrl: `${config.appOrigin}/app/connections`,
    supportUrl: config.marketingOrigin,
  };
}

export function createEmailService(options: EmailServiceOptions): EmailService {
  const config = options.config;
  const store = options.store ?? NULL_EMAIL_STORE;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `emd_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  const log = options.log ?? createEmailLogger();
  const provider = options.provider;

  async function send(request: SendEmailRequest): Promise<EmailSendOutcome> {
    const at = now();
    const idempotencyKey = idempotencyKeyFor(request.type, request.eventId);
    let deliveryId = newId();
    const recipient = request.to.trim().toLowerCase();
    const variables: EmailVariables = { ...baseVariables(config, at), ...request.variables };

    if (!isValidRecipient(recipient)) {
      log('email.send.failed', { emailType: request.type, eventId: request.eventId, errorCode: 'email_invalid_recipient' });
      return { status: 'failed', deliveryId, errorCode: 'email_invalid_recipient', retryable: false };
    }

    // Suppression is checked before rendering so a dead address costs nothing and no copy is built
    // for it. Intake never overrides Calder's own suppression list; this is the local mirror of it.
    try {
      const suppressed = await store.isSuppressed(recipient);
      if (suppressed) {
        await store.createDelivery({
          id: deliveryId, eventId: request.eventId, emailType: request.type, userId: request.userId ?? null,
          recipient, subject: '', idempotencyKey, status: 'skipped', provider: provider?.id ?? null,
        }).catch(() => undefined);
        log('email.send.skipped', {
          emailType: request.type, eventId: request.eventId, userId: request.userId ?? null,
          recipient: maskEmail(recipient), reason: suppressed,
        });
        return { status: 'skipped', deliveryId, reason: 'suppressed' };
      }
      const existing = await store.findByIdempotencyKey(idempotencyKey);
      if (existing?.providerMessageId && ['accepted', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed_remote'].includes(existing.status)) {
        // Local acceptance outlives the provider's replay window. A recovered outbox must not send
        // a second welcome just because the server was down longer than that window.
        return { status: 'sent', deliveryId: existing.id, providerMessageId: existing.providerMessageId, replayed: true };
      }
    } catch {
      // A storage failure must not silently bypass suppression: fail closed (mission §18).
      log('email.send.failed', { emailType: request.type, eventId: request.eventId, errorCode: 'email_internal_error' });
      return { status: 'failed', deliveryId, errorCode: 'email_internal_error', retryable: true };
    }

    if (!provider || !config.configured) {
      await store.createDelivery({
        id: deliveryId, eventId: request.eventId, emailType: request.type, userId: request.userId ?? null,
        recipient, subject: '', idempotencyKey, status: 'skipped', provider: null,
      }).catch(() => undefined);
      log('email.send.skipped', {
        emailType: request.type, eventId: request.eventId, userId: request.userId ?? null, reason: 'not_configured',
      });
      return { status: 'skipped', deliveryId, reason: 'not_configured' };
    }

    let rendered;
    try {
      rendered = renderEmail(request.type, variables, {
        visuals: { assetBaseUrl: config.assetBaseUrl },
        unsubscribeUrl: typeof variables.unsubscribeUrl === 'string' ? variables.unsubscribeUrl : undefined,
      });
    } catch {
      log('email.send.failed', { emailType: request.type, eventId: request.eventId, errorCode: 'email_template_error' });
      return { status: 'failed', deliveryId, errorCode: 'email_template_error', retryable: false };
    }

    // Which identity this leaves from. A caller may ask (an operator writing in the dashboard chooses
    // Daniel or the team), and anything unasked falls back to what the type implies: the personal
    // letters are Daniel, the announcement is the team, everything else is the product talking.
    // Whoever the sender is, reply-to points at a human.
    const implied: EmailSender =
      request.type === 'welcome' || request.type === 'waitlist_welcome' || request.type === 'launch_note' ? 'personal'
      : request.type === 'launch_announcement' ? 'team'
      : 'system';
    const sender = request.sender ?? implied;
    const fromEmail = sender === 'personal' ? config.welcomeFromEmail
      : sender === 'team' ? (config.announcementFromEmail || config.fromEmail)
      : config.fromEmail;
    const fromName = sender === 'personal' ? config.welcomeFromName
      : sender === 'team' ? config.announcementFromName
      : config.fromName;
    const replyTo = sender === 'personal' ? config.welcomeReplyTo
      : sender === 'team' ? (config.welcomeReplyTo || config.replyTo)
      : config.replyTo;
    const message: EmailMessage = {
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: fromEmail || undefined,
      fromName,
      replyTo: replyTo ?? undefined,
      // An operator-composed note travels on its own lane; everything the product decides to send
      // stays transactional. Both are one message per recipient (mission §24).
      // List mail wants `campaign` — different queue, different limits, and a broadcast address that
      // recipients can legitimately mark as bulk. Until the provider actually has that route,
      // asking for it fails the send outright, so this falls back to `transactional` and waits for
      // CALDER_BROADCAST_ENABLED=true. A flag, not a guess: the wrong choice here is a send that
      // looks accepted and lands nowhere.
      stream: (LIST_STREAM_TYPES.has(request.type) && config.broadcastEnabled ? 'campaign' : 'transactional') satisfies EmailStream,
      tags: [{ name: 'email_type', value: request.type }, ...(request.tags ?? [])].slice(0, 20),
      metadata: request.metadata,
      idempotencyKey,
    };
    // Opt-in only: dashboard-managed templates never become a hard dependency (mission §15).
    const alias = request.type === 'waitlist_welcome' || request.type === 'launch_announcement' || request.type === 'launch_note'
      ? undefined
      : config.templateAliases[request.type.replace(/_/g, '-')];
    if (alias) {
      message.template = alias;
      // Only the variables this template needs, so a generic blob can never leak context.
      message.variables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, String(value ?? '')]));
    }

    try {
      // An OTP may appear in the outgoing subject, but must not be persisted in the audit table.
      deliveryId = await store.createDelivery({
        id: deliveryId, eventId: request.eventId, emailType: request.type, userId: request.userId ?? null,
        recipient, subject: request.type === 'otp' ? 'Your Intake verification code' : rendered.subject.slice(0, 500),
        idempotencyKey, status: 'pending', provider: provider.id,
      });
    } catch {
      // Do not hand a new side effect to the provider without a durable event record.
      log('email.store.unavailable', { stage: 'createDelivery' });
      return { status: 'failed', deliveryId, errorCode: 'email_internal_error', retryable: true };
    }

    log('email.send.started', {
      emailType: request.type, eventId: request.eventId, userId: request.userId ?? null,
      recipient: maskEmail(recipient), provider: provider.id,
    });

    try {
      const result = await provider.send(message);
      await store.updateDelivery(deliveryId, {
        status: 'accepted',
        providerMessageId: result.providerMessageId,
        attempts: result.attempts,
        latencyMs: result.latencyMs,
        errorCode: null,
      }).catch(() => undefined);
      log(result.replayed ? 'email.send.replayed' : 'email.send.accepted', {
        emailType: request.type, eventId: request.eventId, userId: request.userId ?? null,
        provider: provider.id, providerMessageId: result.providerMessageId,
        attempts: result.attempts, latencyMs: result.latencyMs,
      });
      return {
        status: 'sent',
        deliveryId,
        providerMessageId: result.providerMessageId,
        replayed: result.replayed,
      };
    } catch (error) {
      const failure = error instanceof EmailError ? error : new EmailError('email_internal_error', 'Email delivery failed.');
      await store.updateDelivery(deliveryId, {
        status: 'failed', errorCode: failure.code, latencyMs: null,
      }).catch(() => undefined);
      log('email.send.failed', {
        emailType: request.type, eventId: request.eventId, userId: request.userId ?? null,
        provider: provider.id, errorCode: failure.code, providerStatus: failure.providerStatus,
        providerCode: failure.providerCode, retryable: failure.retryable,
      });
      return { status: 'failed', deliveryId, errorCode: failure.code, retryable: failure.retryable };
    }
  }

  return {
    providerId: provider?.id ?? 'none',
    configured: config.configured,
    send,
    async status(providerMessageId) {
      if (!provider?.getStatus) return null;
      try {
        return await provider.getStatus(providerMessageId);
      } catch {
        return null;
      }
    },
  };
}
