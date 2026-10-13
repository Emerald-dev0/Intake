import { pool } from './auth';

/** Insert an e‑mail address into the waitlist.
 *  Returns { ok: true, already: false } if the address was new,
 *  or { ok: false, already: true } if it already existed (unique constraint). */
export async function upsertWaitlist(email: string) {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO waitlist (email, created_at) VALUES ($1, now()) ON CONFLICT (email) DO NOTHING',
    );
    // Check if the row was actually inserted by checking for existing row
    const { rows } = await client.query('SELECT id FROM waitlist WHERE email = $1', [email]);
    if (rows.length > 0) {
      return { ok: false, already: true };
    }
    return { ok: true, already: false };
  } catch (e: any) {
    // unique violation – already present
    if (e.code === '23505') {
      return { ok: false, already: true };
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Fetch all waitlist entries, ordered most‑recent first. */
export async function listWaitlist() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC');
    return rows;
  } finally {
    client.release();
  }
}

/** Soft‑remove an entry (optional – marks it as removed rather than deleting). */
export async function removeWaitlist(id: string) {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE waitlist SET email = $1 WHERE id = $2',
      [`${id}_removed`, id],
    );
  } finally {
    client.release();
  }
}