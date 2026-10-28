/**
 * Reconciliation: asking the provider what actually happened to mail it accepted.
 *
 * Calder answers `POST /v1/emails` with 202 and a message id the moment it has queued a message. That
 * is not delivery, and it is not even proof that the message will leave. A transport failure happens
 * minutes later, on their side, and the only two ways Intake can learn about it are a webhook or
 * asking. Webhooks are the good path; this is the one that works when the webhook secret is unset,
 * when the endpoint is misregistered, or when the webhook simply never arrives.
 *
 * Without this, a delivery that Calder accepted and then failed sits at `queued` in Intake's database
 * for ever, and anybody reading that table believes the mail was sent. That is the failure this file
 * exists to make impossible.
 *
 * Deliberate limits:
 *   - Terminal states are never overwritten. A late `delivered` does not un-bounce an address, and
 *     nothing here can resurrect a failure that already happened.
 *   - Only rows with a provider message id are eligible: there is nothing to ask about the others.
 *   - A row younger than the grace period is skipped. Calder queues first and works second, so
 *     asking after ten seconds would report a healthy message as missing.
 */
import type { EmailDeliveryStatus } from './types';

/** Statuses that still owe an answer. `delivered`, `bounced` and friends are already settled. */
export const PENDING_PROVIDER_STATUSES: readonly EmailDeliveryStatus[] = ['accepted', 'queued', 'sent'];

/** States a delivery never walks backwards out of. Kept in step with `webhooks.ts`. */
const TERMINAL: ReadonlySet<EmailDeliveryStatus> = new Set<EmailDeliveryStatus>(['delivered', 'bounced', 'complained', 'failed_remote']);

/**
 * Calder's delivery vocabulary → Intake's.
 *
 * Anything unrecognised returns null, and the caller leaves the row alone. Guessing would be worse
 * than admitting we do not know: a status we invent is a status we will report to a user.
 */
export function mapProviderDeliveryStatus(status: string): EmailDeliveryStatus | null {
  switch (status.trim().toLowerCase()) {
    case 'created': return 'accepted';
    case 'queued': return 'queued';
    case 'sending': return 'queued';
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'bounced': return 'bounced';
    case 'complained': return 'complained';
    case 'failed':
    case 'failed_remote':
    case 'suppressed':
    case 'rejected': return 'failed_remote';
    default: return null;
  }
}

export interface StuckDelivery {
  id: string;
  providerMessageId: string;
  status: EmailDeliveryStatus;
  emailType: string;
  recipient: string;
  createdAt: Date;
}

export interface ReconcileResult {
  checked: number;
  updated: number;
  unchanged: number;
  unknown: number;
  /** Rows the provider could not answer for. Not an error on its own: a deleted message looks the same. */
  unreachable: number;
  changes: Array<{ id: string; emailType: string; from: EmailDeliveryStatus; to: EmailDeliveryStatus }>;
}

export interface ReconcileDeps {
  /** Raw query against `email_delivery`; the email store interface has no "list stuck" verb. */
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** `EmailService.status` — one provider call per row, never used to send. */
  status(providerMessageId: string): Promise<{ status: string } | null>;
  now?: () => Date;
  /** How old a row must be before it is worth asking about. */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 5 * 60_000;

export async function stuckDeliveries(deps: Pick<ReconcileDeps, 'query' | 'now' | 'graceMs'>, limit = 100): Promise<StuckDelivery[]> {
  const now = deps.now?.() ?? new Date();
  const grace = deps.graceMs ?? DEFAULT_GRACE_MS;
  const cutoff = new Date(now.getTime() - grace);
  const result = await deps.query<{
    id: string; provider_message_id: string; status: EmailDeliveryStatus;
    email_type: string; recipient: string; created_at: Date;
  }>(
    `SELECT id, provider_message_id, status, email_type, recipient, created_at
       FROM email_delivery
      WHERE status = ANY($1)
        AND provider_message_id IS NOT NULL
        AND created_at < $2
      ORDER BY created_at
      LIMIT $3`,
    [PENDING_PROVIDER_STATUSES, cutoff, Math.max(1, Math.min(500, limit))],
  );
  return result.rows.map(row => ({
    id: row.id,
    providerMessageId: row.provider_message_id,
    status: row.status,
    emailType: row.email_type,
    recipient: row.recipient,
    createdAt: row.created_at,
  }));
}

export async function reconcileDeliveries(deps: ReconcileDeps, limit = 100): Promise<ReconcileResult> {
  const rows = await stuckDeliveries(deps, limit);
  const result: ReconcileResult = { checked: rows.length, updated: 0, unchanged: 0, unknown: 0, unreachable: 0, changes: [] };
  const now = deps.now?.() ?? new Date();

  for (const row of rows) {
    let snapshot: { status: string } | null;
    try {
      snapshot = await deps.status(row.providerMessageId);
    } catch {
      snapshot = null;
    }
    if (!snapshot) {
      result.unreachable += 1;
      continue;
    }
    const next = mapProviderDeliveryStatus(snapshot.status);
    if (!next) {
      result.unknown += 1;
      continue;
    }
    if (next === row.status || TERMINAL.has(row.status)) {
      result.unchanged += 1;
      continue;
    }
    // `sent` is weaker than `delivered`: never walk a settled delivery backwards.
    if (next === 'sent' && row.status === 'sent') {
      result.unchanged += 1;
      continue;
    }
    await deps.query(
      `UPDATE email_delivery SET status = $2, updated_at = $3, last_event_at = $3
        WHERE id = $1 AND status = ANY($4)`,
      [row.id, next, now, PENDING_PROVIDER_STATUSES],
    );
    result.updated += 1;
    result.changes.push({ id: row.id, emailType: row.emailType, from: row.status, to: next });
  }

  return result;
}
