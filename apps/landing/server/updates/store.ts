/**
 * Update subscriptions: the Pro waitlist and the product-updates list.
 *
 * One row per (email, interest). The address is the only thing stored — no
 * account, no tracking. Subscribe is idempotent: joining twice is joining once.
 */

import type { Pool } from 'pg';

export type UpdateInterest = 'pro' | 'updates';

export interface UpdatesStore {
  subscribe(email: string, interest: UpdateInterest): Promise<'subscribed' | 'already'>;
}

function newId(): string {
  return `us_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

export function createPostgresUpdatesStore(pool: Pool, id: () => string = newId): UpdatesStore {
  return {
    async subscribe(email: string, interest: UpdateInterest): Promise<'subscribed' | 'already'> {
      const recipient = email.trim().toLowerCase();
      try {
        await pool.query(
          `INSERT INTO update_subscription (id, email, interest) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id(), recipient, interest],
        );
      } catch {
        // A storage failure must not leak internals; the route reports unavailability.
        throw new Error('updates_store_unavailable');
      }
      const check = await pool.query('SELECT 1 FROM update_subscription WHERE email = $1 AND interest = $2', [recipient, interest]);
      return check.rowCount ? 'subscribed' : 'already';
    },
  };
}
