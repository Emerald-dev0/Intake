import type { EditOutCome, FormEditErrorCode, FormEditFailure } from '../../src/lib/form-edit';
import type { FormEditSnapshot } from '../../src/lib/form-edit';
import type { EditPlanIssue } from './edit-validation';

export interface FormEditErrorInfo {
  code: FormEditErrorCode;
  message: string;
  outcome?: EditOutCome;
  retryable?: boolean;
  retryAfterSeconds?: number;
  issues?: EditPlanIssue[];
  /** Fresh server-only provider state recovered after an uncertain batch; never serialized to clients. */
  current?: FormEditSnapshot;
}

export class FormEditError extends Error {
  constructor(readonly info: FormEditErrorInfo) {
    super(info.message);
    this.name = 'FormEditError';
  }
}

export function toFormEditFailure(info: FormEditErrorInfo, requestId: string): FormEditFailure {
  return {
    error: info.message,
    code: info.code,
    requestId,
    ...(info.outcome ? { outcome: info.outcome } : {}),
    ...(typeof info.retryable === 'boolean' ? { retryable: info.retryable } : {}),
    ...(Number.isSafeInteger(info.retryAfterSeconds) && (info.retryAfterSeconds as number) > 0 ? { retryAfterSeconds: info.retryAfterSeconds } : {}),
    ...(info.issues?.length ? { issues: info.issues } : {}),
  };
}
