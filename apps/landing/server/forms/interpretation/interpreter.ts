import type { AiFailureCode } from '../../ai/provider';
import type { FormWarning, ValidationIssue } from '../../../src/lib/forms';
import type { FormSpecification } from '../specification';
import type { AiOperationContext } from '../../admin/ai-operations';
import { planGoogleForm } from '../providers/google/plan';
import { parseFormSpecification } from '../validation';

/** Planner codes the model can fix by reshuffling: placement and controller shape, never content. */
const REPAIRABLE_CODES = ['google_condition_placement', 'google_nested_condition', 'google_condition_source_not_required'];
/** Subset whose raw messages are engineer jargon: these get plain language for the user. */
const FRIENDLY_CODES = ['google_condition_placement', 'google_nested_condition'];

/**
 * Returns the Google planner issues for a raw model output that claims to be ready, or [] when
 * there is nothing to repair (other statuses, unparseable specs, clean plans). Lets the caller
 * retry the model with targeted feedback instead of showing engineer text to the user.
 */
export function placementIssues(value: unknown): ValidationIssue[] {
  if (!record(value) || value.status !== 'ready' || !record(value.specification)) return [];
  let specification: FormSpecification;
  try {
    const parsed = parseFormSpecification(value.specification);
    if (!parsed.ok) return [];
    specification = parsed.specification;
  } catch {
    return [];
  }
  const planned = planGoogleForm(specification);
  if (planned.ok) return [];
  return planned.issues;
}

/** True when every issue is a reshuffle problem rather than an unsupported-content problem. */
export function isRepairablePlacement(issues: ValidationIssue[]): boolean {
  return issues.length > 0 && issues.every(issue => REPAIRABLE_CODES.includes(issue.code));
}

/**
 * Plain-language explanation for a layout Google Forms cannot express. Names what to do next
 * instead of quoting question ids and section mechanics.
 */
export function friendlyPlacementExplanation(): string {
  return 'Some follow-up questions branch in a way Google Forms cannot lay out: two conditional groups cannot sit back to back, conditions cannot chain, and a question that controls others must always be shown. Intake already tried reshuffling once. Try folding the second follow-up into the first group, splitting this into two forms, or answering the clarifying question so Intake can restructure it with you.';
}

/** The model can propose data. It cannot authorize, persist, or execute a provider operation. */
export interface InterpretationInput {
  mode: 'new' | 'revise';
  request: string;
  clarification?: string;
  /** Only the server's current, user-owned draft; never a client-supplied specification. */
  specification?: FormSpecification;
  provider: 'google';
  /** Request/user context is used only for secret-free server-side usage metadata. */
  telemetry?: AiOperationContext;
}

export interface FormInterpreter {
  interpret(input: InterpretationInput): Promise<unknown>;
}

export type InterpretationResult =
  | { status: 'ready'; specification: FormSpecification; assumptions: string[]; warnings: FormWarning[] }
  | { status: 'needs_clarification'; question: string }
  | { status: 'unsupported'; explanation: string };

/** One taxonomy for provider and application failures. See server/ai/provider.ts. */
export type InterpretationErrorCode = AiFailureCode;

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
    // Back-to-back and nested layouts get plain language (the repair loop in provider-interpreter
    // usually resolves them before this is ever shown); anything else keeps the planner's specific
    // explanation, which contains no provider payload.
    if (planned.issues.length > 0 && planned.issues.every(issue => FRIENDLY_CODES.includes(issue.code))) {
      return { status: 'unsupported', explanation: friendlyPlacementExplanation() };
    }
    const explanation = planned.issues.slice(0, 2).map(issue => issue.message).join(' ');
    return { status: 'unsupported', explanation: explanation.length > 500 ? `${explanation.slice(0, 497)}…` : explanation };
  }
  return { status: 'ready', specification: parsed.specification, assumptions: value.assumptions.map(item => (item as string).trim()), warnings: planned.plan.warnings };
}
