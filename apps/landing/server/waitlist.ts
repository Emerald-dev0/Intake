import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

export async function upsertWaitlist(email: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id',
      [email],
    );
    if (result.rowCount && result.rowCount > 0) {
      return { ok: true, already: false };
    }
    return { ok: false, already: true };
  } finally {
    client.release();
  }
}

export async function listWaitlist() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC',
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function removeWaitlist(id: string) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM waitlist WHERE id = $1', [id]);
  } finally {
    client.release();
  }
}