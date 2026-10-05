/**
 * Public form-creation contract. Safe to import from the browser: no tokens, no provider payloads.
 *
 * The server builds these shapes; the browser parses them defensively before rendering. The shared
 * specification types live in lib/specification.ts; only the server validates and acts on them.
 */
import { isProviderId, type ProviderId } from './connections';

export const FORM_STAGES = ['connection', 'create', 'add_questions', 'configure_logic', 'publish'] as const;
export type FormStage = (typeof FORM_STAGES)[number];

/**
 * What exists in the provider account after a failed attempt.
 * - not_created: nothing was created. Retrying is safe.
 * - unknown: the create request was sent but its result is not known. A form may exist.
 * - partial: a form exists but is unpublished and may be incomplete.
 */
export const FORM_OUTCOMES = ['not_created', 'unknown', 'partial'] as const;
export type FormOutcome = (typeof FORM_OUTCOMES)[number];

export const FORM_ERROR_CODES = [
  'not_authenticated',
  'forbidden',
  'invalid_request',
  'unsupported_provider',
  'validation_failed',
  'unsupported_by_provider',
  'provider_not_supported',
  'provider_not_configured',
  'provider_not_connected',
  'provider_reauthorization_required',
  'provider_unavailable',
  'provider_permission_denied',
  'provider_rate_limited',
  'provider_rejected',
  'provider_error',
  'storage_unavailable',
  'rate_limited',
  'creation_in_progress',
  'draft_not_found',
  'draft_conflict',
  'draft_locked',
  'model_not_configured',
  'model_timeout',
  'model_unavailable',
  'model_rate_limited',
  'model_provider_error',
  'model_invalid_output',
  'insufficient_credits',
  'internal_error',
] as const;
export type FormErrorCode = (typeof FORM_ERROR_CODES)[number];

/** One thing wrong with a specification. Written so a person or a model can repair it. */
export interface ValidationIssue {
  code: string;
  /** Pointer into the specification, for example questions[2].options. Empty for the whole document. */
  path: string;
  message: string;
  hint?: string;
}

export interface FormWarning {
  code: string;
  questionId?: string;
  message: string;
}

export interface PartialForm {
  providerFormId: string;
  editUrl: string | null;
  /** unpublished: never published. publish_unconfirmed: the publish request was sent but not confirmed. */
  state: 'unpublished' | 'publish_unconfirmed';
}

export interface FormFailure {
  error: string;
  code: FormErrorCode;
  requestId: string;
  issues?: ValidationIssue[];
  provider?: ProviderId;
  stage?: FormStage;
  outcome?: FormOutcome;
  retryable?: boolean;
  /** Reliable server/provider backoff hint, in whole seconds. */
  retryAfterSeconds?: number;
  partialForm?: PartialForm;
}

export interface PublicCreatedForm {
  /** Intake's record id. Null when the form was created but the record could not be saved. */
  id: string | null;
  provider: ProviderId;
  providerFormId: string;
  title: string;
  editUrl: string | null;
  responderUrl: string | null;
  published: boolean;
  createdAt: string | null;
}

export interface PublicFormSummary {
  id: string;
  provider: ProviderId;
  providerFormId: string;
  title: string;
  status: 'created' | 'incomplete';
  failureStage: FormStage | null;
  editUrl: string | null;
  responderUrl: string | null;
  createdAt: string;
}

export interface PublicLibraryForm extends PublicFormSummary {
  description: string | null;
  source: 'created' | 'imported';
  lastSyncedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

export type CreateFormResult =
  | { ok: true; requestId: string; form: PublicCreatedForm; warnings: FormWarning[] }
  | { ok: false; failure: FormFailure };

export function isFormErrorCode(value: unknown): value is FormErrorCode {
  return typeof value === 'string' && (FORM_ERROR_CODES as readonly string[]).includes(value);
}

function isFormStage(value: unknown): value is FormStage {
  return typeof value === 'string' && (FORM_STAGES as readonly string[]).includes(value);
}

function isFormOutcome(value: unknown): value is FormOutcome {
  return typeof value === 'string' && (FORM_OUTCOMES as readonly string[]).includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Only Google Forms links are ever rendered as links. The server already restricts what it returns;
 * this keeps a malformed or tampered response from becoming a javascript: or off-site link.
 */
const FORM_HOSTS = new Set(['docs.google.com']);

export function safeFormUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !FORM_HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
    if (!url.pathname.startsWith('/forms/')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseIssues(value: unknown): ValidationIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const issues: ValidationIssue[] = [];
  for (const item of value.slice(0, 50)) {
    const row = record(item);
    const code = row && text(row.code, 80);
    const message = row && text(row.message, 600);
    if (!row || !code || !message) continue;
    const hint = text(row.hint, 400);
    issues.push({ code, path: typeof row.path === 'string' ? row.path.slice(0, 200) : '', message, ...(hint ? { hint } : {}) });
  }
  return issues;
}

function parseWarnings(value: unknown): FormWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: FormWarning[] = [];
  for (const item of value.slice(0, 50)) {
    const row = record(item);
    const code = row && text(row.code, 80);
    const message = row && text(row.message, 600);
    if (!row || !code || !message) continue;
    const questionId = text(row.questionId, 80);
    warnings.push({ code, message, ...(questionId ? { questionId } : {}) });
  }
  return warnings;
}

function parseCreatedForm(value: unknown): PublicCreatedForm | null {
  const row = record(value);
  if (!row || !isProviderId(typeof row.provider === 'string' ? row.provider : null)) return null;
  const providerFormId = text(row.providerFormId, 255);
  const title = text(row.title, 300);
  if (!providerFormId || !title || typeof row.published !== 'boolean') return null;
  return {
    id: text(row.id, 80),
    provider: row.provider as ProviderId,
    providerFormId,
    title,
    editUrl: safeFormUrl(row.editUrl),
    responderUrl: safeFormUrl(row.responderUrl),
    published: row.published,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
  };
}

function unexpected(status: number): FormFailure {
  return {
    error: status === 401 ? 'Your Intake session ended. Sign in again, then create the form.' : 'Intake returned a response this page could not read. Nothing can be assumed about the form.',
    code: status === 401 ? 'not_authenticated' : 'internal_error',
    requestId: '',
  };
}

export function parseFormFailure(status: number, body: unknown): FormFailure {
  const row = record(body);
  const message = row && text(row.error, 600);
  if (!row || !message) return unexpected(status);
  const code = isFormErrorCode(row.code) ? row.code : status === 401 ? 'not_authenticated' : status >= 500 ? 'internal_error' : 'invalid_request';
  const partial = record(row.partialForm);
  const partialId = partial && text(partial.providerFormId, 255);
  const failure: FormFailure = { error: message, code, requestId: text(row.requestId, 80) ?? '' };
  const issues = parseIssues(row.issues);
  if (issues) failure.issues = issues;
  if (isProviderId(typeof row.provider === 'string' ? row.provider : null)) failure.provider = row.provider as ProviderId;
  if (isFormStage(row.stage)) failure.stage = row.stage;
  if (isFormOutcome(row.outcome)) failure.outcome = row.outcome;
  if (typeof row.retryable === 'boolean') failure.retryable = row.retryable;
  if (typeof row.retryAfterSeconds === 'number' && Number.isSafeInteger(row.retryAfterSeconds) && row.retryAfterSeconds > 0 && row.retryAfterSeconds <= 86_400) failure.retryAfterSeconds = row.retryAfterSeconds;
  if (partial && partialId) {
    failure.partialForm = {
      providerFormId: partialId,
      editUrl: safeFormUrl(partial.editUrl),
      state: partial.state === 'publish_unconfirmed' ? 'publish_unconfirmed' : 'unpublished',
    };
  }
  return failure;
}

export function parseCreateFormResponse(status: number, body: unknown): CreateFormResult {
  if (status >= 200 && status < 300) {
    const row = record(body);
    const form = row ? parseCreatedForm(row.form) : null;
    if (row && form) return { ok: true, requestId: text(row.requestId, 80) ?? '', form, warnings: parseWarnings(row.warnings) };
    return { ok: false, failure: unexpected(status) };
  }
  return { ok: false, failure: parseFormFailure(status, body) };
}

export function parseFormList(data: unknown): PublicFormSummary[] | null {
  const row = record(data);
  if (!row || !Array.isArray(row.forms)) return null;
  const forms: PublicFormSummary[] = [];
  for (const item of row.forms.slice(0, 100)) {
    const form = record(item);
    if (!form) return null;
    const id = text(form.id, 80);
    const providerFormId = text(form.providerFormId, 255);
    const title = text(form.title, 300);
    const createdAt = typeof form.createdAt === 'string' && !Number.isNaN(new Date(form.createdAt).getTime()) ? form.createdAt : null;
    if (!id || !providerFormId || !title || !createdAt || !isProviderId(typeof form.provider === 'string' ? form.provider : null)) return null;
    if (form.status !== 'created' && form.status !== 'incomplete') return null;
    forms.push({
      id,
      provider: form.provider as ProviderId,
      providerFormId,
      title,
      status: form.status,
      failureStage: isFormStage(form.failureStage) ? form.failureStage : null,
      editUrl: safeFormUrl(form.editUrl),
      responderUrl: safeFormUrl(form.responderUrl),
      createdAt,
    });
  }
  return forms;
}

export function parseLibraryForm(data: unknown): PublicLibraryForm | null {
  const form = record(data);
  if (!form) return null;
  const id = text(form.id, 80);
  const providerFormId = text(form.providerFormId, 255);
  const title = text(form.title, 300);
  const createdAt = typeof form.createdAt === 'string' && !Number.isNaN(new Date(form.createdAt).getTime()) ? form.createdAt : null;
  if (!id || !providerFormId || !title || !createdAt || !isProviderId(typeof form.provider === 'string' ? form.provider : null)) return null;
  if (form.status !== 'created' && form.status !== 'incomplete') return null;
  const description = typeof form.description === 'string' ? form.description : null;
  const source = form.source === 'imported' ? 'imported' : 'created';
  const lastSyncedAt = typeof form.lastSyncedAt === 'string' && !Number.isNaN(new Date(form.lastSyncedAt).getTime()) ? form.lastSyncedAt : null;
  const archivedAt = typeof form.archivedAt === 'string' && !Number.isNaN(new Date(form.archivedAt).getTime()) ? form.archivedAt : null;
  const updatedAt = typeof form.updatedAt === 'string' && !Number.isNaN(new Date(form.updatedAt).getTime()) ? form.updatedAt : createdAt;
  return {
    id,
    provider: form.provider as ProviderId,
    providerFormId,
    title,
    description,
    status: form.status,
    failureStage: isFormStage(form.failureStage) ? form.failureStage : null,
    editUrl: safeFormUrl(form.editUrl),
    responderUrl: form.status === 'created' ? safeFormUrl(form.responderUrl) : null,
    source,
    lastSyncedAt,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

export function parseLibraryFormList(data: unknown): PublicLibraryForm[] | null {
  const row = record(data);
  if (!row || !Array.isArray(row.forms)) return null;
  const forms: PublicLibraryForm[] = [];
  for (const item of row.forms.slice(0, 100)) {
    const parsed = parseLibraryForm(item);
    if (!parsed) return null;
    forms.push(parsed);
  }
  return forms;
}

export type FailureAction = 'connect' | 'reconnect' | null;

function outcomeHeading(outcome: FormOutcome | undefined): string {
  if (outcome === 'partial') return 'The form was only partly created';
  if (outcome === 'unknown') return 'Intake could not confirm the result';
  if (outcome === 'not_created') return 'The form was not created';
  return 'Something went wrong';
}

/** How the workspace presents a failure. The wording itself comes from the server so it stays in one place. */
export function describeFailure(failure: FormFailure): { tone: 'warn' | 'bad'; heading: string; action: FailureAction } {
  switch (failure.code) {
    case 'provider_not_connected':
      return { tone: 'warn', heading: 'Google is not connected', action: 'connect' };
    case 'provider_reauthorization_required':
      return { tone: 'warn', heading: 'Google authorization needs renewing', action: 'reconnect' };
    case 'validation_failed':
      return { tone: 'warn', heading: 'The specification is not valid', action: null };
    case 'unsupported_by_provider':
      return { tone: 'warn', heading: 'Google Forms cannot express this form as written', action: null };
    case 'provider_not_supported':
      return { tone: 'warn', heading: 'Creation is not available for this provider yet', action: null };
    case 'model_not_configured':
      return { tone: 'warn', heading: 'Live interpretation needs setup', action: null };
    case 'model_timeout':
    case 'model_unavailable':
    case 'model_invalid_output':
      return { tone: 'warn', heading: 'Intake could not interpret this request', action: null };
    case 'draft_not_found':
    case 'draft_conflict':
    case 'draft_locked':
      return { tone: 'warn', heading: 'Check your draft', action: null };
    case 'creation_in_progress':
      return { tone: 'warn', heading: 'Creation is still in progress or uncertain', action: null };
    case 'rate_limited':
    case 'provider_rate_limited':
      return { tone: 'warn', heading: 'Try again in a moment', action: null };
    case 'not_authenticated':
    case 'forbidden':
    case 'invalid_request':
    case 'unsupported_provider':
      return { tone: 'warn', heading: 'The request was not accepted', action: null };
    default:
      return { tone: 'bad', heading: outcomeHeading(failure.outcome), action: null };
  }
}

/** Starter specification for the developer preview. Kept valid by a test that runs it through the real validator. */
export const EXAMPLE_SPECIFICATION = {
  title: 'Final Year Project Registration',
  description: 'Register for the final-year project showcase.',
  questions: [
    { id: 'full_name', type: 'short_text', title: 'Full name', required: true },
    { id: 'email', type: 'email', title: 'Email address', required: true },
    { id: 'department', type: 'dropdown', title: 'Department', required: true, options: ['Science', 'Arts', 'Engineering'] },
    { id: 'level', type: 'multiple_choice', title: 'Level', required: true, options: ['100', '200', '300', '400', '500'] },
    { id: 'phone', type: 'short_text', title: 'Phone number' },
    { id: 'need_accommodation', type: 'multiple_choice', title: 'Do you need accommodation?', required: true, options: ['Yes', 'No'] },
    {
      id: 'accommodation_type',
      type: 'dropdown',
      title: 'What type of accommodation do you need?',
      required: true,
      options: ['On campus', 'Off campus'],
      visibility: { when: { question: 'need_accommodation', equals: 'Yes' } },
    },
  ],
} as const;

export const EXAMPLE_SPECIFICATION_JSON = JSON.stringify(EXAMPLE_SPECIFICATION, null, 2);
