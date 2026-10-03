import type { FormEditOperation, FormEditPlan, FormEditSnapshot } from '../../../src/lib/form-edit';
import { validateFormEditPlan } from '../edit-validation';
import { InterpretationError } from './interpreter';
import type { AiOperationContext } from '../../admin/ai-operations';

export interface FormEditInterpretationInput {
  request: string;
  clarification?: string;
  current: FormEditSnapshot;
  /** On a revision the model receives its own prior proposal, not a client-authored plan. */
  existingPlan?: FormEditPlan;
  /** Request/user context is used only for secret-free server-side usage metadata. */
  telemetry?: AiOperationContext;
}

export interface FormEditInterpreter {
  interpret(input: FormEditInterpretationInput): Promise<unknown>;
}

export type FormEditInterpretationResult =
  | { status: 'ready'; plan: FormEditPlan }
  | { status: 'needs_clarification'; question: string }
  | { status: 'unsupported'; explanation: string };

const KEYS = ['status', 'summary', 'operations', 'question', 'explanation'] as const;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/** Model output is checked against the fresh form and operation capabilities, not only JSON Schema. */
export function assessFormEditInterpretation(value: unknown, current: FormEditSnapshot): FormEditInterpretationResult {
  if (!record(value) || !exact(value, KEYS)) throw new InterpretationError('model_invalid_output', 'Intake could not validate the proposed edit plan. The form was not changed. Try again or rephrase your request.');
  if (value.status === 'needs_clarification') {
    if (value.summary !== null || value.operations !== null || value.explanation !== null || !text(value.question, 400)) {
      throw new InterpretationError('model_invalid_output', 'Intake could not validate the clarification. The form was not changed.');
    }
    return { status: 'needs_clarification', question: value.question.trim() };
  }
  if (value.status === 'unsupported') {
    if (value.summary !== null || value.operations !== null || value.question !== null || !text(value.explanation, 800)) {
      throw new InterpretationError('model_invalid_output', 'Intake could not validate the capability explanation. The form was not changed.');
    }
    return { status: 'unsupported', explanation: value.explanation.trim() };
  }
  if (value.status !== 'ready' || value.question !== null || value.explanation !== null || !text(value.summary, 500) || !Array.isArray(value.operations)) {
    throw new InterpretationError('model_invalid_output', 'Intake could not validate the proposed edit plan. The form was not changed.');
  }
  const validated = validateFormEditPlan(current, { summary: value.summary, operations: value.operations as FormEditOperation[] });
  if (!validated.ok) {
    const message = validated.issues.slice(0, 3).map(issue => issue.message).join(' ');
    if (validated.issues.some(issue => issue.code === 'unknown_question_id')) {
      return { status: 'needs_clarification', question: 'I could not safely match that instruction to an existing question. Which exact question title in the current form should I change?' };
    }
    if (validated.kind === 'unsupported') return { status: 'unsupported', explanation: message.slice(0, 800) };
    throw new InterpretationError('model_invalid_output', message.slice(0, 800) || 'The proposed changes did not pass validation. The form was not changed.');
  }
  return { status: 'ready', plan: validated.plan };
}
