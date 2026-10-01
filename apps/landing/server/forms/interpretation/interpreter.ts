import type { FormWarning } from '../../../src/lib/forms';
import type { FormSpecification } from '../specification';
import { planGoogleForm } from '../providers/google/plan';
import { parseFormSpecification } from '../validation';

/** The model can propose data. It cannot authorize, persist, or execute a provider operation. */
export interface InterpretationInput {
  mode: 'new' | 'revise';
  request: string;
  clarification?: string;
  /** Only the server's current, user-owned draft; never a client-supplied specification. */
  specification?: FormSpecification;
  provider: 'google';
}

export interface FormInterpreter {
  interpret(input: InterpretationInput): Promise<unknown>;
}

export type InterpretationResult =
  | { status: 'ready'; specification: FormSpecification; assumptions: string[]; warnings: FormWarning[] }
  | { status: 'needs_clarification'; question: string }
  | { status: 'unsupported'; explanation: string };

export type InterpretationErrorCode = 'model_not_configured' | 'model_timeout' | 'model_unavailable' | 'model_invalid_output';

export class InterpretationError extends Error {
  constructor(readonly code: InterpretationErrorCode, message: string) {
    super(message);
    this.name = 'InterpretationError';
  }
}

const invalid = () => new InterpretationError('model_invalid_output', 'Intake could not validate the interpretation. Your draft was not changed. Try again or rephrase your request.');
const keys = ['status', 'specification', 'assumptions', 'question', 'explanation'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).length === allowed.length && allowed.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

/**
 * Enforce the result union even when the model claims to have followed a JSON schema. A ready result
 * must pass BOTH the engine's strict validator and the actual Google planner. A provider limitation
 * becomes an honest unsupported result, never a silently approximated draft.
 */
export function assessInterpretation(value: unknown): InterpretationResult {
  if (!record(value) || !exactly(value, keys) || !Array.isArray(value.assumptions) || value.assumptions.length > 6 ||
      !value.assumptions.every(item => text(item, 240))) throw invalid();

  if (value.status === 'needs_clarification') {
    if (value.specification !== null || value.explanation !== null || value.assumptions.length !== 0 || !text(value.question, 400)) throw invalid();
    return { status: 'needs_clarification', question: value.question.trim() };
  }
  if (value.status === 'unsupported') {
    if (value.specification !== null || value.question !== null || value.assumptions.length !== 0 || !text(value.explanation, 500)) throw invalid();
    return { status: 'unsupported', explanation: value.explanation.trim() };
  }
  if (value.status !== 'ready' || value.question !== null || value.explanation !== null) throw invalid();

  const parsed = parseFormSpecification(value.specification);
  if (!parsed.ok) throw invalid();
  const planned = planGoogleForm(parsed.specification);
  if (!planned.ok) {
    // The planner's messages are specific to the requested layout and contain no provider payload.
    const explanation = planned.issues.slice(0, 2).map(issue => issue.message).join(' ');
    return { status: 'unsupported', explanation: explanation.length > 500 ? `${explanation.slice(0, 497)}…` : explanation };
  }
  return { status: 'ready', specification: parsed.specification, assumptions: value.assumptions.map(item => (item as string).trim()), warnings: planned.plan.warnings };
}
