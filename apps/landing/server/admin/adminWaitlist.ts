import 'dotenv/config';
import { Pool } from 'pg';
import { readCoreServerConfig } from '../config';

export const serverConfig = readCoreServerConfig();

export const pool = new Pool({ connectionString: serverConfig.databaseUrl, max: 10 });

/** Fetch all waitlist entries, ordered most‑recent first. */
export async function listWaitlist() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC',
    );
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