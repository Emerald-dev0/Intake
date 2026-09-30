import type { Pool } from 'pg';
import type { CreateFormResult, FormWarning } from '../../src/lib/forms';
import type { FormSpecification } from './specification';
import type { DraftRecord, DraftStatus, DraftStore } from './draft-store';

interface Row {
  id: string;
  user_id: string;
  provider: 'google';
  version: number;
  status: DraftStatus;
  specification: FormSpecification;
  assumptions: string[];
  warnings: FormWarning[];
  result: CreateFormResult | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, user_id, provider, version, status, specification, assumptions, warnings, result, created_at, updated_at';

function map(row: Row): DraftRecord {
  return {
    id: row.id, userId: row.user_id, provider: row.provider, version: row.version, status: row.status,
    specification: row.specification, assumptions: row.assumptions, warnings: row.warnings, result: row.result,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** SQL is parameterized and all reads/mutations include user_id. No model or browser-supplied account id. */
export function createPostgresDraftStore(pool: Pool): DraftStore {
  return {
    async create(input, now) {
      const result = await pool.query<Row>(
        `INSERT INTO form_draft (id, user_id, provider, specification, assumptions, warnings, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $7) RETURNING ${COLUMNS}`,
        [input.id, input.userId, input.provider, JSON.stringify(input.specification), JSON.stringify(input.assumptions), JSON.stringify(input.warnings), now],
      );
      return map(result.rows[0]);
    },
    async get(userId, id) {
      const result = await pool.query<Row>(`SELECT ${COLUMNS} FROM form_draft WHERE user_id = $1 AND id = $2`, [userId, id]);
      return result.rows[0] ? map(result.rows[0]) : null;
    },
    async revise(userId, id, version, changes, now) {
      const result = await pool.query<Row>(
        `UPDATE form_draft SET specification = $4::jsonb, assumptions = $5::jsonb, warnings = $6::jsonb,
           version = version + 1, result = NULL, updated_at = $7
         WHERE user_id = $1 AND id = $2 AND version = $3 AND status = 'ready' RETURNING ${COLUMNS}`,
        [userId, id, version, JSON.stringify(changes.specification), JSON.stringify(changes.assumptions), JSON.stringify(changes.warnings), now],
      );
      return result.rows[0] ? map(result.rows[0]) : null;
    },
    async claim(userId, id, version, now) {
      const result = await pool.query<Row>(
        `UPDATE form_draft SET status = 'creating', result = NULL, updated_at = $4
         WHERE user_id = $1 AND id = $2 AND version = $3 AND status = 'ready' RETURNING ${COLUMNS}`,
        [userId, id, version, now],
      );
      return result.rows[0] ? map(result.rows[0]) : null;
    },
    async finish(userId, id, status, result, now) {
      const updated = await pool.query<Row>(
        `UPDATE form_draft SET status = $3, result = $4::jsonb, updated_at = $5
         WHERE user_id = $1 AND id = $2 AND status = 'creating' RETURNING id`,
        [userId, id, status, JSON.stringify(result), now],
      );
      return updated.rowCount === 1;
    },
    async discard(userId, id) {
      const result = await pool.query('DELETE FROM form_draft WHERE user_id = $1 AND id = $2 AND status = $3', [userId, id, 'ready']);
      return result.rowCount === 1;
    },
  };
}
