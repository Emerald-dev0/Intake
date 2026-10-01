import type { Pool } from 'pg';
import type { FormEditPlan, FormEditResult, FormEditSnapshot } from '../../src/lib/form-edit';
import type { FormEditDraftRecord, FormEditDraftStore, StoredEditStatus } from './edit-store';

interface Row {
  id: string; user_id: string; provider: 'google'; version: number; status: StoredEditStatus;
  provider_form_id: string; form_record_id: string | null; external_account_id: string;
  current_form: FormEditSnapshot; edit_plan: FormEditPlan; result: FormEditResult | null; created_at: Date; updated_at: Date;
}
const COLUMNS = 'id, user_id, provider, version, status, provider_form_id, form_record_id, external_account_id, current_form, edit_plan, result, created_at, updated_at';
function map(row: Row): FormEditDraftRecord {
  return { id: row.id, userId: row.user_id, provider: row.provider, version: row.version, status: row.status,
    providerFormId: row.provider_form_id, formRecordId: row.form_record_id, externalAccountId: row.external_account_id,
    current: row.current_form, plan: row.edit_plan, result: row.result, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** All draft reads/writes are bound to the authenticated session user. */
export function createPostgresFormEditDraftStore(pool: Pool): FormEditDraftStore {
  return {
    async create(input, now) {
      const result = await pool.query<Row>(
        `INSERT INTO form_edit_draft (id, user_id, provider, provider_form_id, form_record_id, external_account_id, current_form, edit_plan, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $9) RETURNING ${COLUMNS}`,
        [input.id, input.userId, input.provider, input.providerFormId, input.formRecordId, input.externalAccountId,
          JSON.stringify(input.current), JSON.stringify(input.plan), now],
      );
      return map(result.rows[0]);
    },
    async get(userId, id) {
      const result = await pool.query<Row>(`SELECT ${COLUMNS} FROM form_edit_draft WHERE user_id = $1 AND id = $2`, [userId, id]);
      return result.rows[0] ? map(result.rows[0]) : null;
    },
    async revise(userId, id, version, plan, now) {
      const result = await pool.query<Row>(
        `UPDATE form_edit_draft SET edit_plan = $4::jsonb, version = version + 1, result = NULL, updated_at = $5
         WHERE user_id = $1 AND id = $2 AND version = $3 AND status = 'ready' RETURNING ${COLUMNS}`,
        [userId, id, version, JSON.stringify(plan), now],
      );
      return result.rows[0] ? map(result.rows[0]) : null;
    },
    async claim(userId, id, version, now) {
      const result = await pool.query<Row>(
        `UPDATE form_edit_draft SET status = 'applying', result = NULL, updated_at = $4
         WHERE user_id = $1 AND id = $2 AND version = $3 AND status = 'ready' RETURNING ${COLUMNS}`,
        [userId, id, version, now],
      );
      return result.rows[0] ? map(result.rows[0]) : null;
    },
    async markStale(userId, id, version, result, now) {
      const saved = await pool.query(
        `UPDATE form_edit_draft SET status = 'stale', result = $4::jsonb, updated_at = $5
         WHERE user_id = $1 AND id = $2 AND version = $3 AND status = 'ready'`,
        [userId, id, version, JSON.stringify(result), now],
      );
      return saved.rowCount === 1;
    },
    async finish(userId, id, status, result, now, current) {
      const saved = await pool.query(
        `UPDATE form_edit_draft SET status = $3, result = $4::jsonb, current_form = COALESCE($6::jsonb, current_form),
         version = version + CASE WHEN $3 = 'ready' THEN 1 ELSE 0 END, updated_at = $5
         WHERE user_id = $1 AND id = $2 AND status = 'applying'`,
        [userId, id, status, JSON.stringify(result), now, current ? JSON.stringify(current) : null],
      );
      return saved.rowCount === 1;
    },
    async discard(userId, id) {
      const result = await pool.query(`DELETE FROM form_edit_draft WHERE user_id = $1 AND id = $2 AND status = 'ready'`, [userId, id]);
      return result.rowCount === 1;
    },
  };
}
