import type { AiFailureCode } from '../ai/provider';

/** Re-export the canonical provider-independent failure taxonomy used by AI, API mapping and admin records. */
export type { AiFailureCode };

export interface AiOperationContext {
  userId: string;
  requestId: string;
  route: '/api/forms/interpret' | '/api/forms/revise' | '/api/forms/edit/interpret' | '/api/forms/edit/revise';
}

/** Legacy per-request observation contract retained for the provider-independent interpreter tests.
 * Production usage and credit records are written once per logical operation by AiOperationRunner
 * through CreditStore.recordUsage; a second writer here would duplicate/conflict with that source. */
export interface AiOperationRecord extends AiOperationContext {
  operation: 'form_interpretation' | 'form_edit_interpretation';
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
