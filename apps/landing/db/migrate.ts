import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../server/auth';

const dir = fileURLToPath(new URL('./migrations', import.meta.url));

async function main() {
  const client = await pool.connect();
  try {
    const user = await client.query<{ present: string | null }>(`SELECT to_regclass('public."user"') AS present`);
    if (!user.rows[0]?.present) {
      throw new Error('Better Auth tables are missing. Run npm run db:migrate before npm run db:migrate:intake.');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS intake_schema_migration (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(dir)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM intake_schema_migration WHERE id = $1', [file]);
      if (applied.rowCount) {
        console.log(`Skipping ${file}`);
        continue;
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO intake_schema_migration (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exit(1);
});
