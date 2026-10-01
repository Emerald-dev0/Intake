import type { Pool } from 'pg';
import type { ProviderId } from '../../src/lib/connections';
import type { FormSpecification } from './specification';
import type { FormLibraryFilter, FormLibraryRecord, FormRecord, FormSource, FormStatus, FormStore, FormSummaryRecord, IncompleteStage } from './store';

interface FormRow {
  id: string;
  user_id: string;
  provider: ProviderId;
  external_account_id: string;
  provider_form_id: string;
  title: string;
  description?: string | null;
  status: FormStatus;
  edit_url: string | null;
  responder_url: string | null;
  failure_stage: IncompleteStage | null;
  request_id: string;
  specification: unknown;
  specification_version: number;
  source?: FormSource;
  last_synced_at?: Date | null;
  archived_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

type SummaryRow = Pick<FormRow, 'id' | 'provider' | 'provider_form_id' | 'title' | 'status' | 'failure_stage' | 'edit_url' | 'responder_url' | 'created_at'>;

interface LibraryRow extends SummaryRow {
  description: string | null;
  source: FormSource;
  last_synced_at: Date | null;
  archived_at: Date | null;
  updated_at: Date;
}

const COLUMNS = `id, user_id, provider, external_account_id, provider_form_id, title, status, edit_url, responder_url,
  failure_stage, request_id, specification, specification_version, created_at, updated_at`;
const EXTENDED_COLUMNS = `${COLUMNS}, description, source, last_synced_at, archived_at`;
const SUMMARY_COLUMNS = 'id, provider, provider_form_id, title, status, failure_stage, edit_url, responder_url, created_at';
const LIBRARY_COLUMNS = 'id, provider, provider_form_id, title, description, status, failure_stage, edit_url, responder_url, source, last_synced_at, archived_at, created_at, updated_at';

function mapRecord(row: FormRow): FormRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalAccountId: row.external_account_id,
    providerFormId: row.provider_form_id,
    title: row.title,
    description: row.description ?? (row.specification as FormSpecification | null)?.description ?? null,
    status: row.status,
    editUrl: row.edit_url,
    responderUrl: row.responder_url,
    failureStage: row.failure_stage,
    requestId: row.request_id,
    specification: (row.specification as FormSpecification | null) ?? null,
    specificationVersion: row.specification_version,
    source: (row.source as FormSource) ?? 'created',
    lastSyncedAt: row.last_synced_at ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row: SummaryRow): FormSummaryRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerFormId: row.provider_form_id,
    title: row.title,
    status: row.status,
    failureStage: row.failure_stage,
    editUrl: row.edit_url,
    responderUrl: row.responder_url,
    createdAt: row.created_at,
  };
}

function mapLibrary(row: LibraryRow): FormLibraryRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerFormId: row.provider_form_id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    failureStage: row.failure_stage,
    editUrl: row.edit_url,
    responderUrl: row.responder_url,
    source: row.source ?? 'created',
    lastSyncedAt: row.last_synced_at ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function escapeIlike(text: string): string {
  return text.replace(/[%_\\]/g, '\\$&');
}

/** Every read is scoped by the Intake user id from the server session, never from the request body. */
export function createPostgresFormStore(pool: Pool): FormStore {
  return {
    async save(input, now) {
      if (input.source === 'imported') {
        const result = await pool.query<FormRow>(
          `INSERT INTO form (
             id, user_id, provider, external_account_id, provider_form_id, title, status, edit_url, responder_url,
             failure_stage, request_id, specification, specification_version, description, source, last_synced_at, archived_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $18)
           RETURNING ${EXTENDED_COLUMNS}`,
          [
            input.id,
            input.userId,
            input.provider,
            input.externalAccountId,
            input.providerFormId,
            input.title,
            input.status,
            input.editUrl,
            input.responderUrl,
            input.failureStage,
            input.requestId,
            input.specification ? JSON.stringify(input.specification) : null,
            input.specificationVersion,
            input.description ?? null,
            input.source ?? 'imported',
            input.lastSyncedAt ?? now,
            input.archivedAt ?? null,
            now,
          ],
        );
        return mapRecord(result.rows[0]);
      }
      const result = await pool.query<FormRow>(
        `INSERT INTO form (
           id, user_id, provider, external_account_id, provider_form_id, title, status, edit_url, responder_url,
           failure_stage, request_id, specification, specification_version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $14)
         RETURNING ${COLUMNS}`,
        [
          input.id,
          input.userId,
          input.provider,
          input.externalAccountId,
          input.providerFormId,
          input.title,
          input.status,
          input.editUrl,
          input.responderUrl,
          input.failureStage,
          input.requestId,
          JSON.stringify(input.specification),
          input.specificationVersion,
          now,
        ],
      );
      return mapRecord(result.rows[0]);
    },
    async listForUser(userId, limit) {
      const result = await pool.query<SummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM form WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [userId, limit],
      );
      return result.rows.map(mapSummary);
    },
    async listLibrary(userId, filter: FormLibraryFilter = {}) {
      const params: unknown[] = [userId];
      let where = 'WHERE user_id = $1';

      if (filter.archived === true) {
        where += ' AND archived_at IS NOT NULL';
      } else if (filter.archived === 'all') {
        // no filter on archived_at
      } else {
        where += ' AND archived_at IS NULL';
      }

      if (filter.provider && filter.provider !== 'all') {
        params.push(filter.provider);
        where += ` AND provider = $${params.length}`;
      }

      if (filter.source && filter.source !== 'all') {
        params.push(filter.source);
        where += ` AND source = $${params.length}`;
      }

      if (filter.query && filter.query.trim()) {
        params.push(`%${escapeIlike(filter.query.trim())}%`);
        where += ` AND (title ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length})`;
      }

      let orderClause = 'ORDER BY created_at DESC, id DESC';
      if (filter.sort === 'oldest') {
        orderClause = 'ORDER BY created_at ASC, id ASC';
      } else if (filter.sort === 'title_asc') {
        orderClause = 'ORDER BY LOWER(title) ASC, id ASC';
      } else if (filter.sort === 'title_desc') {
        orderClause = 'ORDER BY LOWER(title) DESC, id DESC';
      } else if (filter.sort === 'updated') {
        orderClause = 'ORDER BY updated_at DESC, id DESC';
      } else if (filter.sort === 'synced') {
        orderClause = 'ORDER BY last_synced_at DESC NULLS LAST, created_at DESC, id DESC';
      }

      const limit = Math.min(Math.max(1, filter.limit ?? 50), 100);
      params.push(limit);
      const limitClause = `LIMIT $${params.length}`;

      const result = await pool.query<LibraryRow>(
        `SELECT ${LIBRARY_COLUMNS} FROM form ${where} ${orderClause} ${limitClause}`,
        params,
      );
      return result.rows.map(mapLibrary);
    },
    async getForUser(userId, id) {
      const result = await pool.query<FormRow>(`SELECT ${EXTENDED_COLUMNS} FROM form WHERE user_id = $1 AND id = $2`, [userId, id]);
      return result.rows[0] ? mapRecord(result.rows[0]) : null;
    },
    async getByProviderFormId(userId, provider, providerFormId) {
      const result = await pool.query<FormRow>(
        `SELECT ${EXTENDED_COLUMNS} FROM form WHERE user_id = $1 AND provider = $2 AND provider_form_id = $3`,
        [userId, provider, providerFormId],
      );
      return result.rows[0] ? mapRecord(result.rows[0]) : null;
    },
    async updateMetadata(input, now) {
      if (input.description !== undefined) {
        const result = await pool.query(
          `UPDATE form SET title = $5, edit_url = $6, responder_url = CASE WHEN status = 'created' THEN COALESCE($7, responder_url) ELSE NULL END, updated_at = $8, description = $9, last_synced_at = $8
           WHERE user_id = $1 AND id = $2 AND provider = 'google' AND provider_form_id = $3 AND external_account_id = $4 AND status IN ('created', 'incomplete')`,
          [input.userId, input.id, input.providerFormId, input.externalAccountId, input.title, input.editUrl, input.responderUrl, now, input.description],
        );
        return result.rowCount === 1;
      }
      const result = await pool.query(
        `UPDATE form SET title = $5, edit_url = $6, responder_url = CASE WHEN status = 'created' THEN COALESCE($7, responder_url) ELSE NULL END, updated_at = $8
         WHERE user_id = $1 AND id = $2 AND provider = 'google' AND provider_form_id = $3 AND external_account_id = $4 AND status IN ('created', 'incomplete')`,
        [input.userId, input.id, input.providerFormId, input.externalAccountId, input.title, input.editUrl, input.responderUrl, now],
      );
      return result.rowCount === 1;
    },
    async archive(userId, id, archived, now) {
      const result = await pool.query(
        `UPDATE form SET archived_at = CASE WHEN $3 = true THEN $4 ELSE NULL END, updated_at = $4 WHERE user_id = $1 AND id = $2`,
        [userId, id, archived, now],
      );
      return result.rowCount === 1;
    },
    async remove(userId, id) {
      const result = await pool.query(`DELETE FROM form WHERE user_id = $1 AND id = $2`, [userId, id]);
      return result.rowCount === 1;
    },
    async touchSync(userId, id, metadata: { title: string; description: string | null; editUrl: string | null; responderUrl: string | null }, now) {
      const result = await pool.query(
        `UPDATE form SET title = $3, description = $4, edit_url = $5, responder_url = CASE WHEN status = 'created' THEN COALESCE($6, responder_url) ELSE NULL END, last_synced_at = $7, updated_at = $7
         WHERE user_id = $1 AND id = $2`,
        [userId, id, metadata.title, metadata.description, metadata.editUrl, metadata.responderUrl, now],
      );
      return result.rowCount === 1;
    },
  };
}
