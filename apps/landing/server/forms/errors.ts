import type { ProviderId } from '../../src/lib/connections';
import type { FormErrorCode, FormFailure, FormOutcome, FormStage, PartialForm, ValidationIssue } from '../../src/lib/forms';

/** HTTP status for each error code. The browser reads `code`, never the status alone. */
export const FORM_ERROR_STATUS: Record<FormErrorCode, number> = {
  not_authenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  unsupported_provider: 400,
  validation_failed: 422,
  unsupported_by_provider: 422,
  provider_not_supported: 501,
  provider_not_configured: 503,
  provider_not_connected: 409,
  provider_reauthorization_required: 409,
  provider_unavailable: 503,
  provider_permission_denied: 502,
  provider_rate_limited: 429,
  provider_rejected: 502,
  provider_error: 502,
  storage_unavailable: 503,
  rate_limited: 429,
  creation_in_progress: 409,
  draft_not_found: 404,
  draft_conflict: 409,
  draft_locked: 409,
  model_not_configured: 503,
  model_timeout: 504,
  model_unavailable: 503,
  model_rate_limited: 429,
  model_provider_error: 502,
  model_invalid_output: 502,
  insufficient_credits: 402,
  internal_error: 500,
};

export interface FormErrorInfo {
  code: FormErrorCode;
  /** Human-readable, safe to show. Never contains a token, a stack trace or a raw provider response. */
  message: string;
  issues?: ValidationIssue[];
  provider?: ProviderId;
  stage?: FormStage;
  outcome?: FormOutcome;
  retryable?: boolean;
  retryAfterSeconds?: number;
  detail?: string;
  partialForm?: PartialForm;
}

/**
 * The one error type the form engine throws on purpose. Anything else is a bug and becomes
 * `internal_error` at the engine boundary, so callers never see an unexpected exception shape.
 */
export class FormEngineError extends Error {
  readonly info: FormErrorInfo;
  /** Server-only. Which provider account owned a partly built form. Never serialized to the browser. */
  readonly externalAccountId?: string;

  constructor(info: FormErrorInfo, internal: { externalAccountId?: string } = {}) {
    super(info.message);
    this.name = 'FormEngineError';
    this.info = info;
    this.externalAccountId = internal.externalAccountId;
  }
}

export function toFailureBody(info: FormErrorInfo, requestId: string): FormFailure {
  const body: FormFailure = { error: info.message, code: info.code, requestId };
  if (info.issues?.length) body.issues = info.issues;
  if (info.provider) body.provider = info.provider;
  if (info.stage) body.stage = info.stage;
  if (info.outcome) body.outcome = info.outcome;
  if (typeof info.retryable === 'boolean') body.retryable = info.retryable;
  if (Number.isSafeInteger(info.retryAfterSeconds) && (info.retryAfterSeconds as number) > 0) body.retryAfterSeconds = info.retryAfterSeconds;
  if (info.detail) body.detail = info.detail;
  if (info.partialForm) body.partialForm = info.partialForm;
  return body;
}

export function statusFor(code: FormErrorCode): number {
  return FORM_ERROR_STATUS[code];
}
