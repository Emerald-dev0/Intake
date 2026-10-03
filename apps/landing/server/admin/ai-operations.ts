import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AdminOperation } from './contracts';

export type AiFailureCode = 'model_not_configured' | 'model_timeout' | 'model_unavailable' | 'model_invalid_output';

export interface AiOperationContext {
  userId: string;
  requestId: string;
  route: '/api/forms/interpret' | '/api/forms/revise' | '/api/forms/edit/interpret' | '/api/forms/edit/revise';
}

export interface AiOperationRecord extends AiOperationContext {
  operation: AdminOperation;
  provider: 'groq';
  model: string;
  status: 'succeeded' | 'failed';
  failureCode: AiFailureCode | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: Date;
  completedAt: Date;
}

export type RecordAiOperation = (record: AiOperationRecord) => Promise<void>;

/** Store only model-call metadata. The prompt, form specification, provider credentials and response
 * content are intentionally not part of this contract. Failures are best-effort so observability
 * storage cannot turn a valid user operation into an application failure. */
export function createPostgresAiOperationWriter(pool: Pool): RecordAiOperation {
  return async record => {
    await pool.query(
      `INSERT INTO ai_operation (
         id, request_id, user_id, route, operation, provider, model, status, failure_code,
         latency_ms, input_tokens, output_tokens, started_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (request_id) DO UPDATE SET
         status = EXCLUDED.status,
         failure_code = EXCLUDED.failure_code,
         latency_ms = EXCLUDED.latency_ms,
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         completed_at = EXCLUDED.completed_at`,
      [
        randomUUID(), record.requestId, record.userId, record.route, record.operation,
        record.provider, record.model, record.status, record.failureCode, record.latencyMs,
        record.inputTokens, record.outputTokens, record.startedAt, record.completedAt,
      ],
    );
  };
}
