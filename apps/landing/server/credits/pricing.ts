/**
 * Server-side credit pricing.
 *
 * The AI model never decides what an operation costs, and the browser never submits a price. Both
 * classifiers are deterministic functions of the *validated* result, so the same request always
 * costs the same and an operator can explain any charge by reading this file.
 *
 * Launch price list (Phase 11):
 *   1 credit  — simple edit: one question updated, added, removed, or moved; a single text change
 *   2 credits — normal form creation; a moderate edit (several small changes)
 *   3-5       — complex creation, major restructuring, substantial multi-question modification
 */

export interface CreationComplexity {
  questionCount: number;
  /** Conditional-visibility rules (Google section routing). */
  conditionalCount: number;
}

export interface EditComplexity {
  operationCount: number;
  /** add_question / delete_question / move_question: structural rather than value changes. */
  structuralCount: number;
  /** Distinct existing questions the plan touches. */
  touchedQuestions: number;
}

export const MIN_CREATION_COST = 2;
export const MAX_CREATION_COST = 5;
export const MIN_EDIT_COST = 1;
export const MAX_EDIT_COST = 5;

/**
 * Creation: 2 credits for an ordinary form, rising with size and conditional logic.
 * A 6-question form with no branching is the canonical "normal creation" (2 credits).
 */
export function costForFormCreation(input: CreationComplexity): number {
  const questions = Math.max(0, Math.trunc(input.questionCount));
  const conditions = Math.max(0, Math.trunc(input.conditionalCount));
  const score = questions + 3 * conditions;
  if (score <= 8) return 2;
  if (score <= 14) return 3;
  if (score <= 24) return 4;
  return 5;
}

/**
 * Editing: 1 credit for a single focused change, more for batches and restructuring.
 * Thresholds are on operation count, structural share and touched questions — never on model output.
 */
export function costForFormEdit(input: EditComplexity): number {
  const operations = Math.max(0, Math.trunc(input.operationCount));
  const structural = Math.max(0, Math.trunc(input.structuralCount));
  const touched = Math.max(0, Math.trunc(input.touchedQuestions));
  if (operations <= 1) return 1;
  if (operations <= 3) return structural >= 2 ? 3 : 2;
  if (operations <= 6) return 3;
  if (operations <= 12) return touched >= 5 ? 5 : 4;
  return 5;
}

/** Adapter for a validated creation specification (see src/lib/specification.ts). */
export function creationComplexity(specification: { questions: readonly { visibility?: unknown }[] }): CreationComplexity {
  return {
    questionCount: specification.questions.length,
    conditionalCount: specification.questions.filter(question => question.visibility !== undefined && question.visibility !== null).length,
  };
}

const STRUCTURAL_OPERATIONS = new Set(['add_question', 'delete_question', 'move_question']);

/** Adapter for a validated edit plan (see src/lib/form-edit.ts). */
export function editComplexity(plan: { operations: readonly { type: string; questionId?: string }[] }): EditComplexity {
  const touched = new Set<string>();
  let structural = 0;
  for (const operation of plan.operations) {
    if (STRUCTURAL_OPERATIONS.has(operation.type)) structural += 1;
    if (operation.questionId) touched.add(operation.questionId);
  }
  return { operationCount: plan.operations.length, structuralCount: structural, touchedQuestions: touched.size };
}
