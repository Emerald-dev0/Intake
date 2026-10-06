import { maskEmail } from './types';

/**
 * Secret-free email logging.
 *
 * Safe by construction: keys that look like credentials are replaced before they are ever formatted,
 * and an email address is masked unless a caller explicitly passes an already-masked value. An OTP,
 * a reset token, a password or an API key must never reach this module.
 */

export type EmailLogEvent =
  | 'email.send.started'
  | 'email.send.accepted'
  | 'email.send.replayed'
  | 'email.send.skipped'
  | 'email.send.retrying'
  | 'email.send.failed'
  | 'email.otp.started'
  | 'email.otp.resent'
  | 'email.otp.verified'
  | 'email.otp.rejected'
  | 'email.otp.rate_limited'
  | 'email.password_reset.requested'
  | 'email.password_reset.completed'
  | 'email.address.changed'
  | 'email.password_reset.rejected'
  | 'email.webhook.received'
  | 'email.webhook.rejected'
  | 'email.webhook.replay'
  | 'email.webhook.suppressed'
  | 'email.webhook.unknown_message'
  | 'email.webhook.transient_bounce'
  | 'email.suppression.added'
  | 'email.store.unavailable';

export type EmailLogLevel = 'info' | 'warn' | 'error';

export type EmailLogFields = Record<string, string | number | boolean | null | undefined>;

const LEVELS: Record<EmailLogEvent, EmailLogLevel> = {
  'email.send.started': 'info',
  'email.send.accepted': 'info',
  'email.send.replayed': 'info',
  'email.send.skipped': 'warn',
  'email.send.retrying': 'warn',
  'email.send.failed': 'error',
  'email.otp.started': 'info',
  'email.otp.resent': 'info',
  'email.otp.verified': 'info',
  'email.otp.rejected': 'warn',
  'email.otp.rate_limited': 'warn',
  'email.password_reset.requested': 'info',
  'email.password_reset.completed': 'info',
  'email.address.changed': 'info',
  'email.password_reset.rejected': 'warn',
  'email.webhook.received': 'info',
  'email.webhook.rejected': 'warn',
  'email.webhook.replay': 'info',
  'email.webhook.suppressed': 'warn',
  'email.webhook.unknown_message': 'warn',
  'email.webhook.transient_bounce': 'info',
  'email.suppression.added': 'info',
  'email.store.unavailable': 'error',
};

/** Any key shaped like a secret is dropped, whatever a caller tries to log. */
const SECRET_KEY = /token|secret|password|authorization|apikey|api_key|otp|code|cookie|credential|key$/i;

export function sanitizeEmailLogFields(fields: EmailLogFields): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SECRET_KEY.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    if (key === 'recipient' || key === 'to' || key.endsWith('Email')) {
      safe[key] = typeof value === 'string' ? maskEmail(value) : '[redacted]';
      continue;
    }
    if (typeof value === 'string') safe[key] = value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
    else if (typeof value === 'number') safe[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === 'boolean' || value === null) safe[key] = value;
    else safe[key] = '[unsupported]';
  }
  return safe;
}

export type EmailLogSink = (line: string, level: EmailLogLevel) => void;

function consoleSink(line: string, level: EmailLogLevel): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export type EmailLogger = (event: EmailLogEvent, fields?: EmailLogFields) => void;

export function createEmailLogger(sink: EmailLogSink = consoleSink): EmailLogger {
  return (event, fields = {}) => {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: LEVELS[event],
      event,
      ...sanitizeEmailLogFields(fields),
    });
    sink(line, LEVELS[event]);
  };
}
