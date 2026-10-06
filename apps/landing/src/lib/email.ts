/**
 * Browser contract for Intake email.
 *
 * Everything here talks to Intake, never to a provider. The user's mental model stays "Intake sent
 * me an email"; Calder is infrastructure and never appears in the UI (mission §27).
 */

export interface PublicEmailConfig {
  deliveryConfigured: boolean;
  /** Verification is offered only where delivery actually works, so no one is stranded at a dead end. */
  verificationRequired: boolean;
}

export interface AccountEmailStatus {
  deliveryConfigured: boolean;
  emailVerified: boolean;
  email: string;
}

/** Six-digit codes only: anything else is rejected client-side before it costs an attempt. */
export const OTP_PATTERN = /^\d{6}$/;

export class EmailApiError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'EmailApiError';
  }
}

interface ErrorBody {
  error?: unknown;
  retryAfterSeconds?: unknown;
}

async function readError(response: Response, fallback: string): Promise<EmailApiError> {
  const body = await response.json().catch(() => null) as ErrorBody | null;
  const message = typeof body?.error === 'string' && body.error ? body.error : fallback;
  const retryAfter = typeof body?.retryAfterSeconds === 'number' ? body.retryAfterSeconds : null;
  return new EmailApiError(response.status, message, retryAfter);
}

async function post<T>(path: `/api/${string}`, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw await readError(response, 'Intake could not complete this request. Try again.');
  return response.json() as Promise<T>;
}

export async function fetchPublicEmailConfig(): Promise<PublicEmailConfig> {
  const response = await fetch('/api/account/email/config', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) return { deliveryConfigured: false, verificationRequired: false };
  const body = await response.json() as Partial<PublicEmailConfig>;
  return {
    deliveryConfigured: body.deliveryConfigured === true,
    verificationRequired: body.verificationRequired === true,
  };
}

export async function fetchAccountEmailStatus(): Promise<AccountEmailStatus> {
  const response = await fetch('/api/account/email/status', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw await readError(response, 'Intake could not check your email status.');
  return response.json() as Promise<AccountEmailStatus>;
}

export type SendCodeResult = { status: 'sent'; expiresAt: string; expiresInSeconds: number } | { status: 'already_verified' };

export function requestVerificationCode(): Promise<SendCodeResult> {
  return post<SendCodeResult>('/api/account/email/verify', {});
}

export function confirmVerificationCode(code: string): Promise<{ status: 'verified' }> {
  return post<{ status: 'verified' }>('/api/account/email/verify/confirm', { code });
}

export function requestEmailChange(email: string): Promise<{ status: 'sent'; expiresAt: string }> {
  return post<{ status: 'sent'; expiresAt: string }>('/api/account/email/change', { email });
}

export function confirmEmailChange(code: string): Promise<{ status: 'changed'; email: string }> {
  return post<{ status: 'changed'; email: string }>('/api/account/email/change/confirm', { code });
}

export function requestPasswordReset(email: string): Promise<{ status: 'accepted' }> {
  return post<{ status: 'accepted' }>('/api/account/email/password/reset', { email });
}

/** Human sentence for any email failure. Never surfaces a provider name or an internal code. */
export function emailErrorMessage(error: unknown, fallback = 'Intake could not do that right now. Try again.'): string {
  if (error instanceof EmailApiError) {
    if (error.status === 429 && error.retryAfterSeconds) {
      const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds));
      return seconds >= 60
        ? `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}.`
        : `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
    }
    return error.message || fallback;
  }
  return fallback;
}
