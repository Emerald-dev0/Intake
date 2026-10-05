import { CHOICE_TYPES, QUESTION_TYPES, type FormSpecification, type QuestionSpecification, type QuestionType } from './specification';
import { parseCreateFormResponse, parseFormFailure, type CreateFormResult, type FormFailure, type FormWarning } from './forms';
import { parseOperationCost, type PublicOperationCost } from './credits';

/** Browser contract. Only the id stays in sessionStorage; the actual draft stays server-side. */
export interface PublicDraft {
  id: string;
  provider: 'google';
  version: number;
  status: 'ready' | 'creating' | 'created' | 'blocked';
  specification: FormSpecification;
  assumptions: string[];
  warnings: FormWarning[];
  result: CreateFormResult | null;
  createdAt: string;
  updatedAt: string;
}

export type InterpretResponse =
  | { status: 'ready'; draft: PublicDraft; operationCost?: PublicOperationCost }
  | { status: 'needs_clarification'; question: string; operationCost?: PublicOperationCost }
  | { status: 'unsupported'; explanation: string; operationCost?: PublicOperationCost }
  | { status: 'error'; failure: FormFailure };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function optionalText(value: unknown, max: number): value is string | null | undefined {
  return value === null || value === undefined || (typeof value === 'string' && value.length <= max);
}
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Fail closed on unreadable server data rather than presenting an unsafe creation action. */
function specification(value: unknown): FormSpecification | null {
  const row = record(value);
  if (!row || !text(row.title, 200) || !optionalText(row.description, 2000) || !Array.isArray(row.questions) || !row.questions.length || row.questions.length > 100) return null;
  const questions: QuestionSpecification[] = [];
  const ids = new Set<string>();
  for (const item of row.questions) {
    const question = record(item);
    if (!question || !text(question.id, 64) || !idPattern.test(question.id) || ids.has(question.id.toLowerCase()) ||
        !text(question.title, 500) || !optionalText(question.description, 1000) ||
        !QUESTION_TYPES.includes(question.type as QuestionType) || typeof question.required !== 'boolean') return null;
    const type = question.type as QuestionType;
    const isChoice = CHOICE_TYPES.includes(type);
    if (isChoice && (!Array.isArray(question.options) || !question.options.length || question.options.length > 100 ||
        !question.options.every((option: unknown) => text(option, 200)))) return null;
    if (!isChoice && question.options !== undefined) return null;
    let visibility: QuestionSpecification['visibility'];
    if (question.visibility !== undefined) {
      const when = record(record(question.visibility)?.when);
      if (!when || !text(when.question, 64) || !text(when.equals, 200)) return null;
      const controller = questions.find(prior => prior.id === when.question);
      if (!controller || !['multiple_choice', 'dropdown'].includes(controller.type) || !controller.options?.includes(when.equals)) return null;
      visibility = { when: { question: when.question, equals: when.equals } };
    }
    ids.add(question.id.toLowerCase());
    questions.push({ id: question.id, title: question.title, type, required: question.required,
      ...(question.description ? { description: question.description as string } : {}),
      ...(isChoice ? { options: question.options as string[] } : {}), ...(visibility ? { visibility } : {}) });
  }
  return { title: row.title, ...(row.description ? { description: row.description as string } : {}), questions };
}

function warnings(value: unknown): FormWarning[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const items: FormWarning[] = [];
  for (const item of value) {
    const row = record(item);
    // A valid engine warning can quote a 500-character question title plus its explanation.
    if (!row || !text(row.code, 80) || !text(row.message, 1200) || !optionalText(row.questionId, 80)) return null;
    items.push({ code: row.code, message: row.message, ...(row.questionId ? { questionId: row.questionId as string } : {}) });
  }
  return items;
}

export function parsePublicDraft(value: unknown): PublicDraft | null {
  const row = record(value);
  if (!row || !(typeof row.id === 'string' && draftIdPattern.test(row.id)) || row.provider !== 'google' || !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
      !['ready', 'creating', 'created', 'blocked'].includes(row.status as string) ||
      !text(row.createdAt, 40) || !text(row.updatedAt, 40) || Number.isNaN(Date.parse(row.createdAt)) || Number.isNaN(Date.parse(row.updatedAt))) return null;
  const spec = specification(row.specification);
  const notes = warnings(row.warnings);
  if (!spec || !notes || !Array.isArray(row.assumptions) || row.assumptions.length > 6 || !row.assumptions.every(item => text(item, 240))) return null;
  let result: CreateFormResult | null = null;
  if (row.result !== null) {
    const stored = record(row.result);
    if (!stored || typeof stored.ok !== 'boolean') return null;
    result = stored.ok ? parseCreateFormResponse(201, stored) : { ok: false, failure: parseFormFailure(500, stored.failure) };
    if (stored.ok !== result.ok) return null;
  }
  if ((row.status === 'created' && !result?.ok) ||
      (row.status === 'blocked' && (!result || result.ok || result.failure.outcome === 'not_created')) ||
      (row.status === 'ready' && result && (result.ok || result.failure.outcome !== 'not_created')) ||
      (row.status === 'creating' && result)) return null;
  return {
    id: row.id as string, provider: 'google', version: row.version as number, status: row.status as PublicDraft['status'],
    specification: spec, assumptions: [...row.assumptions] as string[], warnings: notes, result,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

const unreadable: FormFailure = { error: 'Intake returned a response this page could not verify. Check the draft and Recent forms before trying again.', code: 'internal_error', requestId: '', outcome: 'unknown', retryable: false };

export function parseInterpretResponse(status: number, value: unknown): InterpretResponse {
  if (status < 200 || status >= 300) return { status: 'error', failure: parseFormFailure(status, value) };
  const row = record(value);
  const operationCost = parseOperationCost(row);
  const receipt = operationCost ? { operationCost } : {};
  if (row?.status === 'ready') {
    const draft = parsePublicDraft(row.draft);
    if (draft?.status === 'ready') return { status: 'ready', draft, ...receipt };
  }
  if (row?.status === 'needs_clarification' && text(row.question, 400)) return { status: 'needs_clarification', question: row.question, ...receipt };
  if (row?.status === 'unsupported' && text(row.explanation, 500)) return { status: 'unsupported', explanation: row.explanation, ...receipt };
  return { status: 'error', failure: unreadable };
}

export function parseDraftLoad(status: number, value: unknown): { draft: PublicDraft } | { failure: FormFailure } {
  if (status < 200 || status >= 300) return { failure: parseFormFailure(status, value) };
  const draft = parsePublicDraft(record(value)?.draft);
  return draft ? { draft } : { failure: unreadable };
}

export function parseConfirmedResponse(status: number, value: unknown): { result: CreateFormResult; draft: PublicDraft | null } {
  const row = record(value);
  return { result: parseCreateFormResponse(status, value), draft: parsePublicDraft(row?.draft) };
}
