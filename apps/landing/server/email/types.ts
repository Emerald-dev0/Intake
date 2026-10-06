/**
 * Intake email contracts.
 *
 * This file is deliberately free of anything Calder-specific. The application layer sends an
 * `EmailMessage` through an `EmailProvider`; only `providers/calder.ts` knows Calder's HTTP shape.
 *
 * The split of responsibility is the whole point of this module:
 *
 *   Intake  → decides THAT an email is warranted, who receives it, and what it says.
 *   Provider → decides HOW the bytes reach a mailbox.
 *
 * Nothing here may be rendered into a browser response, and nothing here carries a credential.
 */

/** Reputation lane. Intake only ever sends transactional mail (Phase 17 scope, mission §24). */
export type EmailStream = 'transactional' | 'marketing';

/** Internal failure taxonomy (mission §21). Provider errors are mapped into this, never surfaced raw. */
export type EmailErrorCode =
  | 'email_provider_not_configured'
  | 'email_provider_authentication_failed'
  | 'email_provider_rate_limited'
  | 'email_provider_unavailable'
  | 'email_invalid_recipient'
  | 'email_suppressed'
  | 'email_timeout'
  | 'email_template_error'
  | 'email_validation_error'
  | 'email_idempotency_conflict'
  | 'email_quota_exceeded'
  | 'email_sender_not_verified'
  | 'email_internal_error';

/** The catalogue of emails Intake can send. Every entry maps to exactly one template. */
export type EmailType =
  | 'otp'
  | 'password_reset'
  | 'welcome'
  | 'security_password_changed'
  | 'security_email_changed'
  | 'security_new_sign_in'
  | 'security_google_connected'
  | 'security_google_disconnected'
  | 'provider_connection_added'
  | 'provider_connection_removed'
  | 'credits_low'
  | 'billing_subscription_started'
  | 'billing_subscription_renewed'
  | 'billing_subscription_canceled'
  | 'billing_subscription_ending'
  | 'billing_subscription_ended'
  | 'billing_payment_success'
  | 'billing_payment_failed'
  | 'billing_credit_pack_purchased'
  | 'billing_receipt'
  | 'billing_renewal_reminder';

export interface EmailTag {
  name: string;
  value: string;
}

/**
 * A fully rendered, ready-to-deliver message.
 *
 * `template`/`variables` are optional aliases for providers that support server-side templates.
 * Intake always renders `html` and `text` itself, so an empty Calder template dashboard can never
 * break local development or production sending (mission §15).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  /** Provider-side template alias, only when the deployment opts into dashboard-managed templates. */
  template?: string;
  variables?: Record<string, string>;
  tags?: EmailTag[];
  metadata?: Record<string, unknown>;
  stream: EmailStream;
  /** Deterministic: derived from the business event, never random per attempt (mission §8). */
  idempotencyKey: string;
}

export interface ProviderSendResult {
  /** Provider-reported id, e.g. Calder's `em_…`. Stored for delivery-webhook correlation. */
  providerMessageId: string;
  /** Provider status vocabulary, e.g. `queued`. Intake never treats this as "delivered". */
  status: string;
  /** True when the provider replayed a stored idempotency response instead of queueing a new email. */
  replayed: boolean;
  latencyMs: number;
  attempts: number;
}

export interface EmailStatusSnapshot {
  providerMessageId: string;
  status: string;
  updatedAt: string | null;
}

/**
 * The seam between Intake and any delivery vendor.
 *
 * Implementations must never log credentials, must bound their own retries, and must throw
 * `EmailError` (see errors.ts) so the service layer can classify the failure.
 */
export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<ProviderSendResult>;
  /** Optional reconciliation path (`GET /v1/emails/:id` on Calder). Absent providers return null. */
  getStatus?(providerMessageId: string): Promise<EmailStatusSnapshot | null>;
}

/** Lifecycle states Intake tracks for its own record. */
export type EmailDeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'skipped'
  | 'failed'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed_remote';

export type EmailSuppressionReason = 'bounce' | 'complaint' | 'manual';

export interface EmailDeliveryRecord {
  id: string;
  eventId: string;
  emailType: EmailType | string;
  userId: string | null;
  recipient: string;
  subject: string;
  status: EmailDeliveryStatus;
  provider: string | null;
  providerMessageId: string | null;
  idempotencyKey: string;
  attempts: number;
  errorCode: string | null;
  latencyMs: number | null;
  createdAt: Date;
  updatedAt: Date;
  lastEventAt: Date | null;
}

export interface EmailDeliveryInput {
  id: string;
  eventId: string;
  emailType: EmailType | string;
  userId: string | null;
  recipient: string;
  subject: string;
  idempotencyKey: string;
  status: EmailDeliveryStatus;
  provider: string | null;
}

export interface EmailDeliveryUpdate {
  status?: EmailDeliveryStatus;
  providerMessageId?: string | null;
  attempts?: number;
  errorCode?: string | null;
  latencyMs?: number | null;
  lastEventAt?: Date;
}

export interface EmailStats {
  sent: number;
  skipped: number;
  failed: number;
  delivered: number;
  bounced: number;
  complained: number;
  byType: Record<string, number>;
  topErrors: Array<{ code: string; count: number }>;
  suppressions: number;
}

/** Storage contract for delivery records, suppressions and webhook replay protection. */
export interface EmailStore {
  createDelivery(input: EmailDeliveryInput): Promise<void>;
  updateDelivery(id: string, update: EmailDeliveryUpdate): Promise<void>;
  findByProviderMessageId(providerMessageId: string): Promise<EmailDeliveryRecord | null>;
  isSuppressed(email: string): Promise<EmailSuppressionReason | null>;
  suppress(email: string, reason: EmailSuppressionReason, source: string): Promise<void>;
  listSuppressions(limit: number): Promise<Array<{ email: string; reason: string; createdAt: Date }>>;
  /** Returns false when this webhook delivery id was already processed (replay). */
  recordWebhookEvent(eventId: string, type: string, providerMessageId: string | null): Promise<boolean>;
  stats(from: Date, to: Date): Promise<EmailStats>;
}

/** What a caller hands the email service: a business event, not an HTTP request. */
export interface SendEmailRequest {
  type: EmailType;
  to: string;
  /** Deterministic business id; the idempotency key is derived from it (mission §8). */
  eventId: string;
  userId?: string | null;
  variables: Record<string, string>;
  tags?: EmailTag[];
  metadata?: Record<string, unknown>;
}

export type EmailSendOutcome =
  | { status: 'sent'; deliveryId: string; providerMessageId: string; replayed: boolean }
  | { status: 'skipped'; deliveryId: string; reason: 'suppressed' | 'not_configured' | 'duplicate' }
  | { status: 'failed'; deliveryId: string; errorCode: EmailErrorCode; retryable: boolean };

/** Per-address masking used everywhere an email could reach a log line or an admin screen. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.min(3, Math.max(1, local.length - 1)))}@${domain}`;
}
