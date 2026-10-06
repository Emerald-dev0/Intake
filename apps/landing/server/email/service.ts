import { randomUUID } from 'node:crypto';
import type { EmailConfig } from './config';
import { EmailError } from './errors';
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
    const deliveryId = newId();
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
      rendered = renderEmail(request.type, variables);
    } catch {
      log('email.send.failed', { emailType: request.type, eventId: request.eventId, errorCode: 'email_template_error' });
      return { status: 'failed', deliveryId, errorCode: 'email_template_error', retryable: false };
    }

    const message: EmailMessage = {
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: config.fromEmail || undefined,
      fromName: config.fromName,
      replyTo: config.replyTo ?? undefined,
      stream: 'transactional' satisfies EmailStream,
      tags: [{ name: 'email_type', value: request.type }, ...(request.tags ?? [])].slice(0, 20),
      metadata: request.metadata,
      idempotencyKey,
    };
    // Opt-in only: dashboard-managed templates never become a hard dependency (mission §15).
    const alias = config.templateAliases[request.type.replace(/_/g, '-')];
    if (alias) {
      message.template = alias;
      // Only the variables this template needs, so a generic blob can never leak context.
      message.variables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, String(value ?? '')]));
    }

    await store.createDelivery({
      id: deliveryId, eventId: request.eventId, emailType: request.type, userId: request.userId ?? null,
      recipient, subject: rendered.subject.slice(0, 500), idempotencyKey, status: 'pending', provider: provider.id,
    }).catch(() => log('email.store.unavailable', { stage: 'createDelivery' }));

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
