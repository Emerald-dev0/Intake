import type { Pool } from 'pg';
import { normalizeWaitlistEmail } from '../../src/lib/waitlist';

export type WelcomeStatus = 'pending' | 'sending' | 'accepted' | 'suppressed' | 'blocked';

export interface WaitlistEntry {
  id: string;
  email: string;
  createdAt: Date;
  welcomeStatus: WelcomeStatus;
  welcomeAttempts: number;
  welcomeAcceptedAt: Date | null;
  welcomeErrorCode: string | null;
}

export interface WaitlistClaim { id: string; email: string; attempt: number }
export interface WelcomeUpdate {
  status: Exclude<WelcomeStatus, 'sending'>;
  nextAttemptAt: Date;
  errorCode: string | null;
}

export interface WaitlistStore {
  subscribe(email: string): Promise<WaitlistEntry>;
  pendingIds(limit: number): Promise<string[]>;
  claimWelcome(id: string): Promise<WaitlistClaim | null>;
  finishWelcome(claim: WaitlistClaim, update: WelcomeUpdate): Promise<void>;
  list(input: { limit: number; offset: number }): Promise<{ items: WaitlistEntry[]; total: number }>;
}

interface Row {
  id: string;
  email: string;
  created_at: Date;
  welcome_status: WelcomeStatus;
  welcome_attempts: number;
  welcome_accepted_at: Date | null;
  welcome_error_code: string | null;
}

function entry(row: Row): WaitlistEntry {
  return {
    id: row.id, email: row.email, createdAt: row.created_at,
    welcomeStatus: row.welcome_status, welcomeAttempts: row.welcome_attempts,
    welcomeAcceptedAt: row.welcome_accepted_at, welcomeErrorCode: row.welcome_error_code,
  };
}

// Legacy removals leave tombstones for history; they are not subscribers. A bounced or blocked
// welcome alone does not remove a subscription, so those real addresses still count.
const SUBSCRIBER = "welcome_error_code IS DISTINCT FROM 'legacy_removed'";

// The lease exceeds the email adapter's worst-case bounded timeout/retry budget. If a process
// disappears after claiming, another worker recovers it. An attempt number fences stale finishes.
const ELIGIBLE = `(welcome_status = 'pending' AND welcome_next_attempt_at <= now())
  OR (welcome_status = 'sending' AND welcome_claimed_at < now() - interval '5 minutes')`;

export function createPostgresWaitlistStore(pool: Pool): WaitlistStore {
  return {
    async subscribe(email) {
      const result = await pool.query<Row>(
        `INSERT INTO waitlist (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = excluded.email
         RETURNING *`,
        [normalizeWaitlistEmail(email)],
      );
      if (!result.rows[0]) throw new Error('waitlist_store_unavailable');
      return entry(result.rows[0]);
    },
    async pendingIds(limit) {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM waitlist WHERE ${ELIGIBLE} ORDER BY created_at, id LIMIT $1`,
        [Math.max(1, Math.min(20, limit))],
      );
      return result.rows.map(row => row.id);
    },
    async claimWelcome(id) {
      const result = await pool.query<Row>(
        `UPDATE waitlist SET welcome_status = 'sending', welcome_claimed_at = now(),
           welcome_attempts = welcome_attempts + 1
         WHERE id = $1 AND (${ELIGIBLE}) RETURNING *`,
        [id],
      );
      const row = result.rows[0];
      return row ? { id: row.id, email: row.email, attempt: row.welcome_attempts } : null;
    },
    async finishWelcome(claim, update) {
      await pool.query(
        `UPDATE waitlist SET welcome_status = $3, welcome_next_attempt_at = $4,
           welcome_error_code = $5, welcome_claimed_at = NULL,
           welcome_accepted_at = CASE WHEN $3 = 'accepted' THEN now() ELSE welcome_accepted_at END
         WHERE id = $1 AND welcome_status = 'sending' AND welcome_attempts = $2`,
        [claim.id, claim.attempt, update.status, update.nextAttemptAt, update.errorCode],
      );
    },
    async list({ limit, offset }) {
      const [rows, count] = await Promise.all([
        pool.query<Row>(
          `SELECT * FROM waitlist WHERE ${SUBSCRIBER} ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`,
          [Math.max(1, Math.min(100, limit)), Math.max(0, offset)],
        ),
        pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM waitlist WHERE ${SUBSCRIBER}`),
      ]);
      return { items: rows.rows.map(entry), total: Number(count.rows[0]?.total ?? 0) };
    },
  };
}
