/**
 * Launch mail to the wait-list: who still needs it, and how a reader gets off the list.
 *
 * This is deliberately small. Sending a one-time announcement is not a campaign platform, so there
 * is no scheduling, no segments, no dashboard: one query, one HMAC, one row per recipient per
 * campaign. What it does have is the two guarantees that matter when you mail a few hundred people
 * you have never spoken to — a link that actually removes them, and a record that stops the same
 * letter arriving twice if the sender is run again.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

export const LAUNCH_CAMPAIGNS = ['launch_announcement', 'launch_note'] as const;
export type LaunchCampaign = typeof LAUNCH_CAMPAIGNS[number];

export interface LaunchRecipient {
  id: string;
  email: string;
}

export interface LaunchStore {
  /** Subscribers who have not unsubscribed and have not already been sent this campaign. */
  pending(campaign: LaunchCampaign, limit: number): Promise<LaunchRecipient[]>;
  /** Records the outcome. The primary key makes a repeat call a no-op, never a second email. */
  record(recipient: LaunchRecipient, campaign: LaunchCampaign, deliveryId: string | null, state: 'accepted' | 'failed'): Promise<void>;
  /** Idempotent: unsubscribing twice is the same as once. */
  unsubscribe(id: string): Promise<boolean>;
  /** Every subscriber still owed this campaign, for a dry run. */
  countPending(campaign: LaunchCampaign): Promise<number>;
}

const SUBSCRIBER = `w.unsubscribed_at IS NULL AND w.welcome_error_code IS DISTINCT FROM 'legacy_removed'`;

export function createPostgresLaunchStore(pool: Pool): LaunchStore {
  return {
    async pending(campaign, limit) {
      const result = await pool.query<{ id: string; email: string }>(
        `SELECT w.id, w.email FROM waitlist w
          WHERE ${SUBSCRIBER}
            AND NOT EXISTS (
              SELECT 1 FROM waitlist_launch_send s
               WHERE s.waitlist_id = w.id AND s.campaign = $1 AND s.state = 'accepted'
            )
          ORDER BY w.created_at, w.id
          LIMIT $2`,
        [campaign, Math.max(1, Math.min(200, limit))],
      );
      return result.rows;
    },
    async record(recipient, campaign, deliveryId, state) {
      await pool.query(
        `INSERT INTO waitlist_launch_send (waitlist_id, campaign, delivery_id, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (waitlist_id, campaign) DO UPDATE
           SET state = excluded.state, delivery_id = excluded.delivery_id
         WHERE waitlist_launch_send.state = 'failed'`,
        [recipient.id, campaign, deliveryId, state],
      );
    },
    async unsubscribe(id) {
      const result = await pool.query(
        'UPDATE waitlist SET unsubscribed_at = now() WHERE id = $1 AND unsubscribed_at IS NULL RETURNING id',
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async countPending(campaign) {
      const result = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM waitlist w
          WHERE ${SUBSCRIBER}
            AND NOT EXISTS (
              SELECT 1 FROM waitlist_launch_send s
               WHERE s.waitlist_id = w.id AND s.campaign = $1 AND s.state = 'accepted'
            )`,
        [campaign],
      );
      return Number(result.rows[0]?.total ?? 0);
    },
  };
}

/**
 * The unsubscribe link is `?id=<uuid>&token=<hmac>`.
 *
 * The address never appears in a URL, so a forwarded or logged link cannot leak who is on the list,
 * and the token is bound to that one row, so editing the id invalidates it.
 */
export function unsubscribeToken(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`waitlist-unsubscribe:${id}`).digest('base64url').slice(0, 32);
}

export function unsubscribeUrl(appOrigin: string, id: string, secret: string): string {
  const url = new URL('/api/waitlist/unsubscribe', appOrigin);
  url.searchParams.set('id', id);
  url.searchParams.set('token', unsubscribeToken(id, secret));
  return url.toString();
}

/** Constant-time, and false for anything that is not a 32-character token. */
export function verifyUnsubscribeToken(id: string, token: string, secret: string): boolean {
  if (typeof token !== 'string' || token.length !== 32 || !/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  const expected = unsubscribeToken(id, secret);
  const given = Buffer.from(token, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return given.length === want.length && timingSafeEqual(given, want);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWaitlistId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
