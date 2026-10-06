import type { EmailErrorCode } from './types';

/**
 * Typed email failures.
 *
 * `EmailError` is the only error type allowed to cross the provider boundary. Providers map their
 * own status codes and payloads into this taxonomy so no Calder-specific string ever reaches a
 * route handler, a log line or a browser (mission §21).
 */
export class EmailError extends Error {
  readonly code: EmailErrorCode;
  readonly retryable: boolean;
  /** HTTP status from the provider, when there was one. Never exposed to the browser. */
  readonly providerStatus: number | null;
  /** Raw provider error code, kept for logs and admin aggregation only. */
  readonly providerCode: string | null;

  constructor(
    code: EmailErrorCode,
    message: string,
    options: { retryable?: boolean; providerStatus?: number | null; providerCode?: string | null } = {},
  ) {
    super(message);
    this.name = 'EmailError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerStatus = options.providerStatus ?? null;
    this.providerCode = options.providerCode ?? null;
  }
}

/** Failures that may be worth another attempt: throttling, outages, timeouts, in-flight idempotency. */
const RETRYABLE: ReadonlySet<EmailErrorCode> = new Set<EmailErrorCode>([
  'email_provider_rate_limited',
  'email_provider_unavailable',
  'email_timeout',
  'email_idempotency_conflict',
  'email_internal_error',
]);

export function isRetryableEmailError(error: unknown): boolean {
  return error instanceof EmailError && RETRYABLE.has(error.code);
}

/** Safe, human sentences for the handful of email states a signed-in user can act on. */
export function emailUserMessage(code: EmailErrorCode): string {
  switch (code) {
    case 'email_provider_not_configured':
      return 'Email delivery is not switched on for this Intake server yet.';
    case 'email_invalid_recipient':
      return 'That email address does not look valid. Check it and try again.';
    case 'email_suppressed':
      return 'This address previously bounced or reported mail as spam, so Intake stopped sending to it.';
    case 'email_provider_rate_limited':
      return 'Too many emails were requested just now. Wait a minute and try again.';
    case 'email_timeout':
    case 'email_provider_unavailable':
    case 'email_internal_error':
      return 'Intake could not reach its email provider. Try again shortly.';
    case 'email_quota_exceeded':
      return 'Intake has reached its email sending allowance. Try again later.';
    default:
      return 'Intake could not send this email. Try again shortly.';
  }
}

/**
 * Maps a Calder error code into Intake's taxonomy. Unknown codes fail closed as unavailable so a
 * new provider error can never be mistaken for success.
 */
export function mapCalderError(
  code: string | undefined,
  status: number,
  message: string,
): EmailError {
  switch (code) {
    case 'validation_error':
      return new EmailError('email_validation_error', message, { providerStatus: status, providerCode: code });
    case 'authentication_error':
      return new EmailError('email_provider_authentication_failed', message, { providerStatus: status, providerCode: code });
    case 'authorization_error':
      return new EmailError('email_provider_authentication_failed', message, { providerStatus: status, providerCode: code });
    case 'rate_limit_error':
      return new EmailError('email_provider_rate_limited', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'idempotency_conflict':
      return new EmailError('email_idempotency_conflict', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'conflict':
      return new EmailError('email_idempotency_conflict', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'suppressed':
      return new EmailError('email_suppressed', message, { providerStatus: status, providerCode: code });
    case 'domain_not_verified':
    case 'sender_not_ready':
      return new EmailError('email_sender_not_verified', message, { providerStatus: status, providerCode: code });
    case 'plan_limit_reached':
      return new EmailError('email_quota_exceeded', message, { providerStatus: status, providerCode: code });
    case 'organization_sending_unavailable':
      return new EmailError('email_provider_unavailable', message, { retryable: true, providerStatus: status, providerCode: code });
    case 'not_found':
      return new EmailError('email_validation_error', message, { providerStatus: status, providerCode: code });
    case 'provider_error':
    case 'internal_error':
      return new EmailError('email_provider_unavailable', message, { retryable: true, providerStatus: status, providerCode: code });
    default:
      if (status === 401 || status === 403) {
        return new EmailError('email_provider_authentication_failed', message, { providerStatus: status, providerCode: code ?? null });
      }
      if (status === 429) {
        return new EmailError('email_provider_rate_limited', message, { retryable: true, providerStatus: status, providerCode: code ?? null });
      }
      if (status === 422) {
        return new EmailError('email_validation_error', message, { providerStatus: status, providerCode: code ?? null });
      }
      if (status >= 500) {
        return new EmailError('email_provider_unavailable', message, { retryable: true, providerStatus: status, providerCode: code ?? null });
      }
      return new EmailError('email_provider_unavailable', message, { providerStatus: status, providerCode: code ?? null });
  }
}
