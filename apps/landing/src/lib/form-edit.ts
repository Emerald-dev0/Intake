/** Public, provider-independent contract for reviewing and editing an existing form. */
import { safeFormUrl } from './forms';
import { QUESTION_TYPES, type QuestionType } from './specification';

export type EditOutCome = 'not_applied' | 'partial' | 'unknown' | 'stale';
export type FormEditErrorCode =
  | 'not_authenticated' | 'forbidden' | 'invalid_request' | 'unsupported_provider'
  | 'provider_not_configured' | 'provider_not_connected' | 'provider_reauthorization_required'
  | 'provider_unavailable' | 'provider_permission_denied' | 'provider_rate_limited' | 'provider_rejected'
  | 'provider_error' | 'storage_unavailable' | 'rate_limited' | 'model_not_configured' | 'model_timeout'
  | 'model_unavailable' | 'model_invalid_output' | 'form_not_found' | 'form_not_editable' | 'invalid_form_url'
  | 'edit_unsupported' | 'edit_plan_invalid' | 'edit_stale' | 'edit_draft_not_found'
  | 'edit_draft_conflict' | 'edit_draft_locked' | 'internal_error';

export interface FormEditFailure {
  error: string;
  code: FormEditErrorCode;
  requestId: string;
  outcome?: EditOutCome;
  retryable?: boolean;
  detail?: string;
  issues?: { code: string; path: string; message: string; hint?: string }[];
}

export type FormEditItemKind = 'question' | 'section' | 'text' | 'media' | 'question_group' | 'other';
export type EditQuestionType = QuestionType | 'date' | 'time' | 'scale' | 'rating' | 'file_upload' | 'grid' | 'unknown';
export type EditCapability = 'update_title' | 'update_description' | 'update_required' | 'update_type' | 'update_options' | 'delete' | 'move';

/** A sanitized view of one current provider item. IDs are the actual Google IDs, never model-created IDs. */
export interface FormEditItem {
  itemId: string;
  questionId?: string;
  index: number;
  sectionIndex: number;
  kind: FormEditItemKind;
  title: string;
  description?: string;
  questionType?: EditQuestionType;
  required?: boolean;
  options?: string[];
  hasRouting?: boolean;
  capabilities: EditCapability[];
}

/** The provider revision and account id remain server-side; this is safe for the workspace to display. */
export interface FormEditView {
  providerFormId: string;
  title: string;
  description?: string;
  editUrl: string;
  responderUrl: string | null;
  items: FormEditItem[];
  hasSections: boolean;
  hasBranching: boolean;
}

export interface FormEditSnapshot extends FormEditView {
  revisionId: string;
  isQuiz: boolean;
}

export type NewEditQuestion = {
  title: string;
  description?: string;
  type: Exclude<QuestionType, 'email'>;
  required?: boolean;
  options?: string[];
};

export type QuestionEditChanges = {
  title?: string;
  description?: string;
  type?: Exclude<QuestionType, 'email'>;
  required?: boolean;
  options?: string[];
};

export type FormEditOperation =
  | { type: 'update_title'; title: string }
  | { type: 'update_description'; description: string }
  | { type: 'add_question'; question: NewEditQuestion; position?: number }
  | { type: 'update_question'; questionId: string; changes: QuestionEditChanges }
  | { type: 'delete_question'; questionId: string }
  | { type: 'move_question'; questionId: string; position: number };

/** formId is assigned by Intake from the selected target; the model never chooses it. */
export interface FormEditPlan {
  formId: string;
  summary: string;
  operations: FormEditOperation[];
}

export interface ReviewEditChange {
  type: FormEditOperation['type'];
  title: string;
  detail: string;
  destructive: boolean;
}

export interface FormEditSuccess {
  ok: true;
  requestId: string;
  providerFormId: string;
  title: string;
  editUrl: string;
  responderUrl: string | null;
  recordUpdated: boolean;
}

export interface FormEditRejected {
  ok: false;
  failure: FormEditFailure;
}
export type FormEditResult = FormEditSuccess | FormEditRejected;
export type FormEditDraftStatus = 'ready' | 'applying' | 'applied' | 'blocked' | 'stale';

export interface PublicFormEditDraft {
  id: string;
  provider: 'google';
  version: number;
  status: FormEditDraftStatus;
  current: FormEditView;
  plan: FormEditPlan;
  changes: ReviewEditChange[];
  result: FormEditResult | null;
  createdAt: string;
  updatedAt: string;
}

export type FormEditInterpretResponse =
  | { status: 'ready'; draft: PublicFormEditDraft }
  | { status: 'needs_clarification'; question: string }
  | { status: 'unsupported'; explanation: string }
  | { status: 'error'; failure: FormEditFailure };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
}
function safeType(value: unknown): value is EditQuestionType {
  return typeof value === 'string' && ['short_text', 'long_text', 'email', 'multiple_choice', 'dropdown', 'checkboxes', 'date', 'time', 'scale', 'rating', 'file_upload', 'grid', 'unknown'].includes(value);
}
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toFormEditView(snapshot: FormEditSnapshot): FormEditView {
  return {
    providerFormId: snapshot.providerFormId,
    title: snapshot.title,
    ...(snapshot.description !== undefined ? { description: snapshot.description } : {}),
    editUrl: snapshot.editUrl,
    responderUrl: snapshot.responderUrl,
    items: snapshot.items.map(item => ({ ...item, capabilities: [...item.capabilities], ...(item.options ? { options: [...item.options] } : {}) })),
    hasSections: snapshot.hasSections,
    hasBranching: snapshot.hasBranching,
  };
}

function parseView(value: unknown): FormEditView | null {
  const row = record(value);
  if (!row || !text(row.providerFormId, 256) || !text(row.title, 300, true) ||
      !text(row.editUrl, 2048) || safeFormUrl(row.editUrl) !== row.editUrl ||
      !(row.responderUrl === null || (text(row.responderUrl, 2048) && safeFormUrl(row.responderUrl) === row.responderUrl)) ||
      !Array.isArray(row.items) || row.items.length > 1000 || typeof row.hasSections !== 'boolean' || typeof row.hasBranching !== 'boolean' ||
      !(row.description === undefined || text(row.description, 4000, true))) return null;
  const items: FormEditItem[] = [];
  const itemIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const value of row.items) {
    const item = record(value);
    if (!item || !text(item.itemId, 64) || !ID.test(item.itemId) || itemIds.has(item.itemId) ||
        !Number.isSafeInteger(item.index) || (item.index as number) < 0 || !Number.isSafeInteger(item.sectionIndex) || (item.sectionIndex as number) < 0 ||
        !['question', 'section', 'text', 'media', 'question_group', 'other'].includes(item.kind as string) || !text(item.title, 1000, true) ||
        !(item.description === undefined || text(item.description, 4000, true)) || !Array.isArray(item.capabilities) ||
        !item.capabilities.every(capability => ['update_title', 'update_description', 'update_required', 'update_type', 'update_options', 'delete', 'move'].includes(String(capability))) ||
        !(item.questionId === undefined || (text(item.questionId, 64) && ID.test(item.questionId) && !questionIds.has(item.questionId))) ||
        !(item.questionType === undefined || safeType(item.questionType)) || !(item.required === undefined || typeof item.required === 'boolean') ||
        !(item.hasRouting === undefined || typeof item.hasRouting === 'boolean') ||
        !(item.options === undefined || (Array.isArray(item.options) && item.options.length <= 200 && item.options.every(option => text(option, 500, true)))) ) return null;
    itemIds.add(item.itemId);
    if (item.questionId) questionIds.add(item.questionId as string);
    items.push({
      itemId: item.itemId, index: item.index as number, sectionIndex: item.sectionIndex as number,
      kind: item.kind as FormEditItemKind, title: item.title,
      ...(item.questionId ? { questionId: item.questionId as string } : {}),
      ...(item.description !== undefined ? { description: item.description as string } : {}),
      ...(item.questionType ? { questionType: item.questionType as EditQuestionType } : {}),
      ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
      ...(item.options ? { options: [...item.options] as string[] } : {}),
      ...(typeof item.hasRouting === 'boolean' ? { hasRouting: item.hasRouting } : {}),
      capabilities: [...item.capabilities] as EditCapability[],
    });
  }
  if (items.some((item, index) => item.index !== index)) return null;
  return {
    providerFormId: row.providerFormId, title: row.title as string,
    ...(row.description !== undefined ? { description: row.description as string } : {}),
    editUrl: row.editUrl, responderUrl: row.responderUrl as string | null, items,
    hasSections: row.hasSections, hasBranching: row.hasBranching,
  };
}

function parseQuestion(value: unknown): NewEditQuestion | null {
  const row = record(value);
  if (!row || !text(row.title, 500) || !(row.description === undefined || row.description === null || text(row.description, 1000, true)) ||
      !['short_text', 'long_text', 'multiple_choice', 'dropdown', 'checkboxes'].includes(row.type as string) ||
      !(row.required === undefined || typeof row.required === 'boolean') ||
      !(row.options === undefined || (Array.isArray(row.options) && row.options.length <= 100 && row.options.every(option => text(option, 200))))) return null;
  return {
    title: row.title,
    type: row.type as NewEditQuestion['type'],
    ...(row.description !== undefined && row.description !== null ? { description: row.description as string } : {}),
    ...(typeof row.required === 'boolean' ? { required: row.required } : {}),
    ...(Array.isArray(row.options) ? { options: [...row.options] as string[] } : {}),
  };
}

function parsePlan(value: unknown, formId: string): FormEditPlan | null {
  const row = record(value);
  if (!row || row.formId !== formId || !text(row.summary, 500) || !Array.isArray(row.operations) || row.operations.length < 1 || row.operations.length > 20) return null;
  const operations: FormEditOperation[] = [];
  for (const value of row.operations) {
    const op = record(value);
    if (!op || typeof op.type !== 'string') return null;
    if (op.type === 'update_title' && text(op.title, 200)) operations.push({ type: op.type, title: op.title });
    else if (op.type === 'update_description' && text(op.description, 2000, true)) operations.push({ type: op.type, description: op.description });
    else if (op.type === 'add_question' && parseQuestion(op.question)) {
      if (op.position !== undefined && (!Number.isSafeInteger(op.position) || (op.position as number) < 0)) return null;
      operations.push({ type: op.type, question: parseQuestion(op.question)!, ...(op.position !== undefined ? { position: op.position as number } : {}) });
    } else if (op.type === 'update_question' && text(op.questionId, 64) && ID.test(op.questionId) && record(op.changes)) {
      const changes = record(op.changes)!;
      const allowed = ['title', 'description', 'type', 'required', 'options'];
      if (Object.keys(changes).some(key => !allowed.includes(key)) || Object.keys(changes).length < 1 ||
          (changes.title !== undefined && !text(changes.title, 500)) ||
          (changes.description !== undefined && !text(changes.description, 1000, true)) ||
          (changes.type !== undefined && !['short_text', 'long_text', 'multiple_choice', 'dropdown', 'checkboxes'].includes(changes.type as string)) ||
          (changes.required !== undefined && typeof changes.required !== 'boolean') ||
          (changes.options !== undefined && (!Array.isArray(changes.options) || changes.options.length > 100 || !changes.options.every(option => text(option, 200)))) ) return null;
      operations.push({ type: op.type, questionId: op.questionId, changes: structuredClone(changes) as QuestionEditChanges });
    } else if ((op.type === 'delete_question') && text(op.questionId, 64) && ID.test(op.questionId)) operations.push({ type: op.type, questionId: op.questionId });
    else if (op.type === 'move_question' && text(op.questionId, 64) && ID.test(op.questionId) && Number.isSafeInteger(op.position) && (op.position as number) >= 0) {
      operations.push({ type: op.type, questionId: op.questionId, position: op.position as number });
    } else return null;
  }
  return { formId, summary: row.summary, operations };
}

function parseFailure(value: unknown): FormEditFailure | null {
  const row = record(value);
  if (!row || !text(row.error, 800) || typeof row.code !== 'string' || !text(row.requestId, 80, true)) return null;
  const outcomes: EditOutCome[] = ['not_applied', 'partial', 'unknown', 'stale'];
  return {
    error: row.error, code: row.code as FormEditErrorCode, requestId: row.requestId,
    ...(outcomes.includes(row.outcome as EditOutCome) ? { outcome: row.outcome as EditOutCome } : {}),
    ...(typeof row.retryable === 'boolean' ? { retryable: row.retryable } : {}),
    ...(text(row.detail, 400) ? { detail: row.detail as string } : {}),
    ...(Array.isArray(row.issues) ? { issues: row.issues.slice(0, 50).flatMap(item => {
      const issue = record(item);
      if (!issue || !text(issue.code, 80) || !text(issue.message, 600)) return [];
      return [{ code: issue.code, path: typeof issue.path === 'string' ? issue.path.slice(0, 200) : '', message: issue.message, ...(text(issue.hint, 400) ? { hint: issue.hint as string } : {}) }];
    }) } : {}),
  };
}

function parseSuccess(value: unknown): FormEditSuccess | null {
  const row = record(value);
  if (!row || row.ok !== true || !text(row.requestId, 80, true) || !text(row.providerFormId, 256) || !text(row.title, 300, true) ||
      !text(row.editUrl, 2048) || safeFormUrl(row.editUrl) !== row.editUrl ||
      !(row.responderUrl === null || (text(row.responderUrl, 2048) && safeFormUrl(row.responderUrl) === row.responderUrl)) || typeof row.recordUpdated !== 'boolean') return null;
  return { ok: true, requestId: row.requestId, providerFormId: row.providerFormId, title: row.title as string, editUrl: row.editUrl,
    responderUrl: row.responderUrl as string | null, recordUpdated: row.recordUpdated };
}

export function parseFormEditDraft(value: unknown): PublicFormEditDraft | null {
  const row = record(value);
  if (!row || !text(row.id, 36) || !DRAFT_ID.test(row.id) || row.provider !== 'google' || !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
      !['ready', 'applying', 'applied', 'blocked', 'stale'].includes(row.status as string) ||
      !text(row.createdAt, 40) || Number.isNaN(Date.parse(row.createdAt)) || !text(row.updatedAt, 40) || Number.isNaN(Date.parse(row.updatedAt))) return null;
  const current = parseView(row.current);
  const plan = current && parsePlan(row.plan, current.providerFormId);
  if (!current || !plan || !Array.isArray(row.changes) || row.changes.length !== plan.operations.length) return null;
  const changes: ReviewEditChange[] = [];
  for (const value of row.changes) {
    const change = record(value);
    if (!change || typeof change.type !== 'string' || !text(change.title, 240) || !text(change.detail, 1000) || typeof change.destructive !== 'boolean') return null;
    changes.push({ type: change.type as FormEditOperation['type'], title: change.title, detail: change.detail, destructive: change.destructive });
  }
  let result: FormEditResult | null = null;
  if (row.result !== null) {
    const stored = record(row.result);
    result = stored?.ok === true ? parseSuccess(stored) : stored?.ok === false && parseFailure(stored.failure)
      ? { ok: false, failure: parseFailure(stored.failure)! } : null;
    if (!result) return null;
  }
  if ((row.status === 'applied' && !result?.ok) || (row.status === 'blocked' && (!result || result.ok || ['not_applied', 'stale'].includes(result.failure.outcome ?? ''))) ||
      (row.status === 'stale' && (!result || result.ok || result.failure.outcome !== 'stale')) || (row.status === 'applying' && result)) return null;
  return { id: row.id, provider: 'google', version: row.version as number, status: row.status as FormEditDraftStatus, current, plan, changes, result,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function parseFormEditInspect(status: number, value: unknown): { form: FormEditView } | { failure: FormEditFailure } {
  if (status < 200 || status >= 300) return { failure: parseFailure(value) ?? fallbackFailure(status) };
  const row = record(value);
  const form = row && parseView(row.form);
  return form ? { form } : { failure: fallbackFailure(status) };
}

export function parseFormEditInterpret(status: number, value: unknown): FormEditInterpretResponse {
  if (status < 200 || status >= 300) return { status: 'error', failure: parseFailure(value) ?? fallbackFailure(status) };
  const row = record(value);
  if (row?.status === 'ready') {
    const draft = parseFormEditDraft(row.draft);
    if (draft?.status === 'ready') return { status: 'ready', draft };
  }
  if (row?.status === 'needs_clarification' && text(row.question, 400)) return { status: 'needs_clarification', question: row.question };
  if (row?.status === 'unsupported' && text(row.explanation, 800)) return { status: 'unsupported', explanation: row.explanation };
  return { status: 'error', failure: fallbackFailure(status) };
}

export function parseFormEditDraftLoad(status: number, value: unknown): { draft: PublicFormEditDraft } | { failure: FormEditFailure } {
  if (status < 200 || status >= 300) return { failure: parseFailure(value) ?? fallbackFailure(status) };
  const row = record(value);
  const draft = row && parseFormEditDraft(row.draft);
  return draft ? { draft } : { failure: fallbackFailure(status) };
}

export function parseFormEditConfirm(status: number, value: unknown): { draft: PublicFormEditDraft; result: FormEditResult } | { failure: FormEditFailure; draft: PublicFormEditDraft | null } {
  const row = record(value);
  const draft = row && parseFormEditDraft(row.draft);
  if (status >= 200 && status < 300 && draft?.result?.ok) return { draft, result: draft.result };
  const failure = (row && parseFailure(row.failure)) ?? parseFailure(value) ?? fallbackFailure(status);
  return { failure, draft };
}

export function editChanges(plan: FormEditPlan, current: FormEditView): ReviewEditChange[] {
  const question = (id: string) => current.items.find(item => item.questionId === id);
  const shown = (value: string | undefined, empty = 'empty') => value ? `“${value}”` : `(${empty})`;
  return plan.operations.map(operation => {
    if (operation.type === 'update_title') return { type: operation.type, title: 'Form title', detail: `${shown(current.title)} → ${shown(operation.title)}`, destructive: false };
    if (operation.type === 'update_description') return { type: operation.type, title: 'Form description', detail: `${shown(current.description, 'no description')} → ${shown(operation.description, 'no description')}`, destructive: false };
    if (operation.type === 'add_question') {
      const q = operation.question;
      const options = q.options?.length ? ` Choices: ${q.options.join(' · ')}.` : '';
      return { type: operation.type, title: 'Add question', detail: `“${q.title}” · ${editTypeLabel(q.type)} · ${q.required ? 'required' : 'optional'}.${options}`, destructive: false };
    }
    const target = question(operation.questionId);
    const name = target?.title || 'Question';
    if (operation.type === 'delete_question') return { type: operation.type, title: 'Remove question', detail: `“${name}”`, destructive: true };
    if (operation.type === 'move_question') return { type: operation.type, title: 'Move question', detail: `“${name}” · item position ${(target?.index ?? 0) + 1} → ${operation.position + 1}`, destructive: false };
    const parts: string[] = [];
    const changes = operation.changes;
    if (changes.title !== undefined) parts.push(`Title: ${shown(target?.title)} → ${shown(changes.title)}`);
    if (changes.description !== undefined) parts.push(`Help text: ${shown(target?.description, 'none')} → ${shown(changes.description, 'none')}`);
    if (changes.required !== undefined) parts.push(`Required: ${target?.required ? 'Yes' : 'No'} → ${changes.required ? 'Yes' : 'No'}`);
    if (changes.type !== undefined) parts.push(`Type: ${editTypeLabel(target?.questionType ?? 'unknown')} → ${editTypeLabel(changes.type)}`);
    if (changes.options !== undefined) parts.push(`Choices: ${target?.options?.length ? target.options.join(' · ') : '(none)'} → ${changes.options.length ? changes.options.join(' · ') : '(none)'}`);
    return { type: operation.type, title: name, detail: parts.join(' · '), destructive: false };
  });
}

export function editTypeLabel(type: string): string {
  return ({ short_text: 'Short answer', long_text: 'Paragraph', email: 'Short answer', multiple_choice: 'Multiple choice', dropdown: 'Dropdown', checkboxes: 'Checkboxes', date: 'Date', time: 'Time', scale: 'Scale', rating: 'Rating', file_upload: 'File upload', grid: 'Question grid', unknown: 'Unsupported question' } as Record<string, string>)[type] ?? 'Question';
}

function fallbackFailure(status: number): FormEditFailure {
  return { error: status === 401 ? 'Your Intake session ended. Sign in again.' : 'Intake returned a response this page could not verify. The form was not changed.',
    code: status === 401 ? 'not_authenticated' : 'internal_error', requestId: '', outcome: 'unknown', retryable: false };
}

/** Only used to make sure shared changes continue using the established question-type vocabulary. */
export const SUPPORTED_EDIT_QUESTION_TYPES: readonly QuestionType[] = QUESTION_TYPES.filter(type => type !== 'email');
