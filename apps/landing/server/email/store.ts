import type { Pool } from 'pg';
import type {
  EmailDeliveryInput, EmailDeliveryRecord, EmailDeliveryUpdate, EmailStore, EmailSuppressionReason,
} from './types';

/**
 * Email storage.
 *
 * Three tables, each earning its place (mission §19):
 *
 *  - email_delivery  → the traceability chain: Intake event → provider id → webhook outcome.
 *  - email_suppression → so Intake stops mailing addresses Calder knows are dead or hostile.
 *  - email_webhook_event → replay protection for delivery webhooks.
 *
 * OTP and password-reset state is deliberately NOT here: it lives in Better Auth's `verification`
 * table so there is exactly one authentication system (mission §19, §26).
 */

interface Row {
  id: string;
  event_id: string;
  email_type: string;
  user_id: string | null;
  recipient: string;
  subject: string;
  status: string;
  provider: string | null;
  provider_message_id: string | null;
  idempotency_key: string;
  attempts: number;
  error_code: string | null;
  latency_ms: number | null;
  created_at: Date;
  updated_at: Date;
  last_event_at: Date | null;
}

function toRecord(row: Row): EmailDeliveryRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    emailType: row.email_type,
    userId: row.user_id,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status as EmailDeliveryRecord['status'],
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    errorCode: row.error_code,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventAt: row.last_event_at,
  };
}

const STATUS_VALUES = new Set([
  'pending', 'accepted', 'skipped', 'failed', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed_remote',
]);

function columnFor(field: keyof EmailDeliveryUpdate): string {
  switch (field) {
    case 'status': return 'status';
    case 'providerMessageId': return 'provider_message_id';
    case 'attempts': return 'attempts';
    case 'errorCode': return 'error_code';
    case 'latencyMs': return 'latency_ms';
    case 'lastEventAt': return 'last_event_at';
    default: throw new Error('Unsupported email delivery field');
  }
}

export function createPostgresEmailStore(pool: Pool): EmailStore {
  return {
    async createDelivery(input) {
      await pool.query(
        `INSERT INTO email_delivery
           (id, event_id, email_type, user_id, recipient, subject, status, provider, idempotency_key, attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          input.id, input.eventId, input.emailType, input.userId, input.recipient.toLowerCase(),
          input.subject.slice(0, 500), input.status, input.provider, input.idempotencyKey,
        ],
      );
    },

    async updateDelivery(id, update) {
      const entries = Object.entries(update).filter(([, value]) => value !== undefined);
      if (!entries.length) return;
      if (update.status && !STATUS_VALUES.has(update.status)) throw new Error('Unsupported email delivery status');
      const assignments = entries.map(([field], index) => `${columnFor(field as keyof EmailDeliveryUpdate)} = $${index + 2}`).join(', ');
      await pool.query(
        `UPDATE email_delivery SET ${assignments}, updated_at = now() WHERE id = $1`,
        [id, ...entries.map(([, value]) => value)],
      );
    },

    async findByProviderMessageId(providerMessageId) {
      const result = await pool.query<Row>('SELECT * FROM email_delivery WHERE provider_message_id = $1 LIMIT 1', [providerMessageId]);
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async isSuppressed(email) {
      const result = await pool.query<{ reason: string }>(
        'SELECT reason FROM email_suppression WHERE email = $1 LIMIT 1',
        [email.trim().toLowerCase()],
      );
      return (result.rows[0]?.reason as EmailSuppressionReason | undefined) ?? null;
    },

    async suppress(email, reason, source) {
      await pool.query(
        `INSERT INTO email_suppression (email, reason, source)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET reason = excluded.reason, source = excluded.source, updated_at = now()`,
        [email.trim().toLowerCase(), reason, source.slice(0, 80)],
      );
    },

    async listSuppressions(limit) {
      const result = await pool.query<{ email: string; reason: string; created_at: Date }>(
        'SELECT email, reason, created_at FROM email_suppression ORDER BY created_at DESC LIMIT $1',
        [Math.min(Math.max(1, limit), 200)],
      );
      return result.rows.map(row => ({ email: row.email, reason: row.reason, createdAt: row.created_at }));
    },

    async recordWebhookEvent(eventId, type, providerMessageId) {
      // The insert IS the replay guard: a duplicate delivery id cannot insert twice.
      const result = await pool.query(
        `INSERT INTO email_webhook_event (event_id, event_type, provider_message_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, type.slice(0, 64), providerMessageId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async stats(from, to) {
      const [totals, byType, errors, suppressions] = await Promise.all([
        pool.query<{ status: string; count: string }>(
          'SELECT status, count(*)::text AS count FROM email_delivery WHERE created_at >= $1 AND created_at < $2 GROUP BY status',
          [from, to],
        ),
        pool.query<{ email_type: string; count: string }>(
          'SELECT email_type, count(*)::text AS count FROM email_delivery WHERE created_at >= $1 AND created_at < $2 GROUP BY email_type ORDER BY count(*) DESC',
          [from, to],
        ),
        pool.query<{ error_code: string; count: string }>(
          `SELECT error_code, count(*)::text AS count FROM email_delivery
           WHERE created_at >= $1 AND created_at < $2 AND error_code IS NOT NULL
           GROUP BY error_code ORDER BY count(*) DESC LIMIT 8`,
          [from, to],
        ),
        pool.query<{ count: string }>('SELECT count(*)::text AS count FROM email_suppression'),
      ]);
      type StatusRow = { status: string; count: string };
      const count = (rows: StatusRow[], status: string): number =>
        Number(rows.find(row => row.status === status)?.count ?? 0);
      const totalsRows: StatusRow[] = totals.rows;
      return {
        sent: count(totalsRows, 'accepted') + count(totalsRows, 'sent') + count(totalsRows, 'delivered'),
        skipped: count(totalsRows, 'skipped'),
        failed: count(totalsRows, 'failed') + count(totalsRows, 'failed_remote'),
        delivered: count(totalsRows, 'delivered'),
        bounced: count(totalsRows, 'bounced'),
        complained: count(totalsRows, 'complained'),
        byType: Object.fromEntries(byType.rows.map(row => [row.email_type, Number(row.count)])),
        topErrors: errors.rows.map(row => ({ code: row.error_code, count: Number(row.count) })),
        suppressions: Number(suppressions.rows[0]?.count ?? 0),
      };
    },
  };
}

/** In-memory store with identical semantics, used by tests and by `EMAIL_PROVIDER=memory`. */
export function createMemoryEmailStore(): EmailStore & { deliveries: EmailDeliveryRecord[] } {
  const deliveries = new Map<string, EmailDeliveryRecord>();
  const suppressions = new Map<string, { email: string; reason: string; createdAt: Date }>();
  const webhookEvents = new Set<string>();

  function blank(input: EmailDeliveryInput): EmailDeliveryRecord {
    const now = new Date();
    return {
      id: input.id,
      eventId: input.eventId,
      emailType: input.emailType,
      userId: input.userId,
      recipient: input.recipient,
      subject: input.subject,
      status: input.status,
      provider: input.provider,
      providerMessageId: null,
      idempotencyKey: input.idempotencyKey,
      attempts: 0,
      errorCode: null,
      latencyMs: null,
      createdAt: now,
      updatedAt: now,
      lastEventAt: null,
    };
  }

  return {
    deliveries: [] as EmailDeliveryRecord[],
    async createDelivery(input) {
      if (!deliveries.has(input.idempotencyKey)) deliveries.set(input.idempotencyKey, blank(input));
    },
    async updateDelivery(id, update) {
      for (const record of deliveries.values()) {
        if (record.id !== id) continue;
        Object.assign(record, update, { updatedAt: new Date() });
        return;
      }
    },
    async findByProviderMessageId(providerMessageId) {
      return [...deliveries.values()].find(record => record.providerMessageId === providerMessageId) ?? null;
    },
    async isSuppressed(email) {
      return (suppressions.get(email.trim().toLowerCase())?.reason as EmailSuppressionReason | undefined) ?? null;
    },
    async suppress(email, reason) {
      suppressions.set(email.trim().toLowerCase(), { email: email.trim().toLowerCase(), reason, createdAt: new Date() });
    },
    async listSuppressions(limit) {
      return [...suppressions.values()].slice(0, limit);
    },
    async recordWebhookEvent(eventId) {
      if (webhookEvents.has(eventId)) return false;
      webhookEvents.add(eventId);
      return true;
    },
    async stats() {
      const all = [...deliveries.values()];
      const count = (status: string) => all.filter(record => record.status === status).length;
      const byType: Record<string, number> = {};
      const errors = new Map<string, number>();
      for (const record of all) {
        byType[record.emailType] = (byType[record.emailType] ?? 0) + 1;
        if (record.errorCode) errors.set(record.errorCode, (errors.get(record.errorCode) ?? 0) + 1);
      }
      return {
        sent: count('accepted') + count('sent') + count('delivered'),
        skipped: count('skipped'),
        failed: count('failed') + count('failed_remote'),
        delivered: count('delivered'),
        bounced: count('bounced'),
        complained: count('complained'),
        byType,
        topErrors: [...errors.entries()].map(([code, n]) => ({ code, count: n })),
        suppressions: suppressions.size,
      };
    },
  };
}

/** A store whose absence degrades logging but never blocks a critical path. */
export const NULL_EMAIL_STORE: EmailStore = {
  async createDelivery() {},
  async updateDelivery() {},
  async findByProviderMessageId() { return null; },
  async isSuppressed() { return null; },
  async suppress() {},
  async listSuppressions() { return []; },
  async recordWebhookEvent() { return true; },
  async stats() {
    return { sent: 0, skipped: 0, failed: 0, delivered: 0, bounced: 0, complained: 0, byType: {}, topErrors: [], suppressions: 0 };
  },
};
