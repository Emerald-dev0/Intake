/**
 * Submissions to a hosted developer form.
 *
 * The rules live here, on the server, in one place:
 *
 * - A submission is validated against the **published version** that was live when it arrived, not
 *   against the current draft. A form can be edited tomorrow without changing what counted as a
 *   valid answer today.
 * - A field the form does not have is refused. A stale client cannot smuggle extra data in.
 * - A retry does not create a second response: the idempotency key is unique per form.
 * - Nothing is stored that was not asked for. The source metadata is the referrer and the user
 *   agent, truncated — no address, no fingerprint.
 */

import { randomUUID } from 'node:crypto';
import type { DevField, DevFormDefinition } from './contracts.js';

export interface DevSubmission {
  id: string;
  formId: string;
  formVersionId: string;
  projectId: string;
  answers: Record<string, string | number | boolean | string[]>;
  source: { referrer?: string; userAgent?: string };
  idempotencyKey: string | null;
  submittedAt: Date;
}

export interface DevSubmissionError {
  field: string;
  message: string;
}

export type DevSubmissionValidation =
  | { ok: true; answers: DevSubmission['answers'] }
  | { ok: false; errors: DevSubmissionError[] };

/** The longest a single answer may be, per field type. */
const TEXT_LIMITS: Record<string, number> = {
  short_text: 500,
  long_text: 5000,
  email: 200,
  number: 40,
  date: 10,
  dropdown: 120,
  single_choice: 120,
  checkbox: 5,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How many fields a single submission may carry. */
export const MAX_ANSWERED_FIELDS = 60;

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Checks one answer against its field. */
function validateAnswer(field: DevField, raw: unknown, errors: DevSubmissionError[]): string | number | boolean | string[] | undefined {
  const limit = TEXT_LIMITS[field.type] ?? 500;

  if (field.type === 'checkbox') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (isEmpty(raw)) return undefined;
    errors.push({ field: field.id, message: 'This should be a yes or a no.' });
    return undefined;
  }

  if (field.type === 'multiple_choice') {
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
    const cleaned = list.map(entry => String(entry).trim()).filter(entry => entry.length > 0);
    if (cleaned.length > field.options.length) {
      errors.push({ field: field.id, message: 'That has more answers than the question has options.' });
      return undefined;
    }
    for (const entry of cleaned) {
      if (!field.options.includes(entry)) {
        errors.push({ field: field.id, message: 'One of the answers is not an option on this form.' });
        return undefined;
      }
    }
    return cleaned;
  }

  if (typeof raw !== 'string' && typeof raw !== 'number') {
    if (isEmpty(raw)) return undefined;
    errors.push({ field: field.id, message: 'That answer is not in the right shape.' });
    return undefined;
  }

  const text = String(raw).trim();
  if (text.length === 0) return undefined;
  if (text.length > limit) {
    errors.push({ field: field.id, message: 'That answer is too long.' });
    return undefined;
  }

  if (field.type === 'email' && !EMAIL.test(text)) {
    errors.push({ field: field.id, message: 'That does not look like an email address.' });
    return undefined;
  }
  if (field.type === 'number') {
    const value = Number(text);
    if (!Number.isFinite(value)) {
      errors.push({ field: field.id, message: 'That has to be a number.' });
      return undefined;
    }
    return value;
  }
  if (field.type === 'date') {
    if (!DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      errors.push({ field: field.id, message: 'That has to be a date, like 2026-10-29.' });
      return undefined;
    }
    return text;
  }
  if ((field.type === 'dropdown' || field.type === 'single_choice') && !field.options.includes(text)) {
    errors.push({ field: field.id, message: 'That is not one of the options on this form.' });
    return undefined;
  }
  return text;
}

/** Validates a whole submission against a published definition. */
export function validateSubmission(
  definition: DevFormDefinition,
  body: unknown,
): DevSubmissionValidation {
  const errors: DevSubmissionError[] = [];
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const incoming = (typeof raw.answers === 'object' && raw.answers !== null ? raw.answers : raw) as Record<string, unknown>;

  const fields = definition.fields;
  const known = new Set(fields.map(field => field.id));

  for (const key of Object.keys(incoming)) {
    if (!known.has(key)) {
      errors.push({ field: key, message: 'This form does not have that question.' });
    }
  }
  if (Object.keys(incoming).length > MAX_ANSWERED_FIELDS) {
    errors.push({ field: 'answers', message: 'That submission has more answers than the form has questions.' });
  }

  const answers: DevSubmission['answers'] = {};
  for (const field of fields) {
    const value = validateAnswer(field, incoming[field.id], errors);
    if (value === undefined) {
      if (field.required) {
        errors.push({ field: field.id, message: 'This question needs an answer.' });
      }
      continue;
    }
    if (field.type === 'checkbox' && field.required && value !== true) {
      errors.push({ field: field.id, message: 'This box has to be ticked.' });
      continue;
    }
    answers[field.id] = value;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, answers };
}

/** Keeps only what is safe to keep about where a submission came from. */
export function readSource(headers: Record<string, string | string[] | undefined>): DevSubmission['source'] {
  const referrer = headers['referer'] ?? headers['referrer'];
  const userAgent = headers['user-agent'];
  const source: DevSubmission['source'] = {};
  if (typeof referrer === 'string' && referrer) source.referrer = referrer.slice(0, 300);
  if (typeof userAgent === 'string' && userAgent) source.userAgent = userAgent.slice(0, 200);
  return source;
}

/** A client-supplied key has to look like a key before it is trusted with anything. */
export function normaliseIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length < 8 || key.length > 200) return null;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

export function newSubmissionId(): string {
  return `sub_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
