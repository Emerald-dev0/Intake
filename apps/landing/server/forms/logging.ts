import { randomBytes } from 'node:crypto';
import { redact } from '../providers/oauth';

/**
 * Structured, secret-free logging for form operations. One JSON object per line so a request can be
 * followed by `requestId`. Fields are allow-listed by shape and by key name: a value under a key that
 * looks like a credential is dropped even if a caller passes one by mistake.
 */
export type FormLogEvent =
  | 'form.create.started'
  | 'form.create.validation_failed'
  | 'form.create.provider_request'
  | 'form.create.provider_failed'
  | 'form.create.completed'
  | 'form.create.rejected'
  | 'form.create.persist_failed';

type LogValue = string | number | boolean | null | undefined | readonly string[];
export type FormLogFields = Record<string, LogValue>;
export type FormLogger = (event: FormLogEvent, fields: FormLogFields) => void;
export type LogLevel = 'info' | 'warn' | 'error';

const SECRET_KEY = /token|secret|authorization|password|cookie|verifier|ciphertext|credential|apikey/i;
const MAX_STRING = 300;

const LEVELS: Record<FormLogEvent, LogLevel> = {
  'form.create.started': 'info',
  'form.create.provider_request': 'info',
  'form.create.completed': 'info',
  'form.create.validation_failed': 'warn',
  'form.create.rejected': 'warn',
  'form.create.provider_failed': 'error',
  'form.create.persist_failed': 'error',
};

function cleanString(value: string): string {
  return redact(value.replace(/[\u0000-\u001f\u007f]/g, ' ')).slice(0, MAX_STRING);
}

export function sanitizeLogFields(fields: FormLogFields): Record<string, string | number | boolean | null | string[]> {
  const safe: Record<string, string | number | boolean | null | string[]> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SECRET_KEY.test(key)) {
      safe[key] = '[redacted]';
    } else if (typeof value === 'string') {
      safe[key] = cleanString(value);
    } else if (typeof value === 'number') {
      safe[key] = Number.isFinite(value) ? value : null;
    } else if (typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = value.slice(0, 20).map(item => cleanString(String(item)));
    }
  }
  return safe;
}

export function createFormLogger(sink: (line: string, level: LogLevel) => void = consoleSink): FormLogger {
  return (event, fields) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level: LEVELS[event], event, ...sanitizeLogFields(fields) });
    sink(line, LEVELS[event]);
  };
}

function consoleSink(line: string, level: LogLevel): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Opaque trace id returned to the caller and written on every log line for the operation. */
export function newRequestId(): string {
  return `req_${randomBytes(9).toString('base64url')}`;
}
