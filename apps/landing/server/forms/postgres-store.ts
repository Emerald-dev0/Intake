import type { Pool } from 'pg';
import type { ProviderId } from '../../src/lib/connections';
import type { FormSpecification } from './specification';
import type { FormRecord, FormStatus, FormStore, FormSummaryRecord, IncompleteStage } from './store';

interface FormRow {
  id: string;
  user_id: string;
  provider: ProviderId;
  external_account_id: string;
  provider_form_id: string;
  title: string;
  status: FormStatus;
  edit_url: string | null;
  responder_url: string | null;
  failure_stage: IncompleteStage | null;
  request_id: string;
  specification: unknown;
  specification_version: number;
  created_at: Date;
  updated_at: Date;
}

type SummaryRow = Pick<FormRow, 'id' | 'provider' | 'provider_form_id' | 'title' | 'status' | 'failure_stage' | 'edit_url' | 'responder_url' | 'created_at'>;

const COLUMNS = `id, user_id, provider, external_account_id, provider_form_id, title, status, edit_url, responder_url,
  failure_stage, request_id, specification, specification_version, created_at, updated_at`;
const SUMMARY_COLUMNS = 'id, provider, provider_form_id, title, status, failure_stage, edit_url, responder_url, created_at';

function mapRecord(row: FormRow): FormRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalAccountId: row.external_account_id,
    providerFormId: row.provider_form_id,
    title: row.title,
    status: row.status,
    editUrl: row.edit_url,
    responderUrl: row.responder_url,
    failureStage: row.failure_stage,
    requestId: row.request_id,
    specification: row.specification as FormSpecification,
    specificationVersion: row.specification_version,
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

/** Every read is scoped by the Intake user id from the server session, never from the request body. */
export function createPostgresFormStore(pool: Pool): FormStore {
  return {
    async save(input, now) {
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
  };
}
