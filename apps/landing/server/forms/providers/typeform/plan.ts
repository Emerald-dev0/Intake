import type { FormWarning, ValidationIssue } from '../../../../src/lib/forms';
import type { FormSpecification, QuestionType } from '../../specification';
import { TypeformField, TypeformFieldType, TypeformLogic, TypeformLogicAction, TypeformLogicCondition, TypeformSettings, TypeformWelcomeScreen, TypeformThankYouScreen } from './client';

export interface TypeformPlan {
  title: string;
  settings: TypeformSettings;
  fields: TypeformField[];
  logic: TypeformLogic[];
  welcomeScreens: TypeformWelcomeScreen[];
  thankYouScreens: TypeformThankYouScreen[];
  warnings: FormWarning[];
}

export type PlanResult = { ok: true; plan: TypeformPlan } | { ok: false; issues: ValidationIssue[] };

/** A stable, spec-derived ref. Question ids are already unique and validated. */
function fieldRef(questionId: string): string {
  return `q_${questionId}`;
}

/** Typeform choice refs exist only on choice types that support them (not dropdowns). */
function choiceRef(questionId: string, index: number): string {
  return `${fieldRef(questionId)}_choice_${index}`;
}

interface VisibilityRun {
  start: number;
  end: number;
  key: string | null;
  condition: { question: string; equals: string } | null;
}

const TYPEFORM_FIELD_MAP: Record<QuestionType, TypeformFieldType> = {
  short_text: 'short_text',
  long_text: 'long_text',
  email: 'email',
  multiple_choice: 'multiple_choice',
  dropdown: 'dropdown',
  checkboxes: 'multiple_choice',
};

export function planTypeform(specification: FormSpecification): PlanResult {
  const questions = specification.questions;
  const indexById = new Map<string, number>();
  questions.forEach((question, index) => indexById.set(question.id, index));

  const issues: ValidationIssue[] = [];

  // Check for unsupported question types
  questions.forEach((question) => {
    if (!TYPEFORM_FIELD_MAP[question.type]) {
      issues.push({
        code: 'unsupported_question_type',
        path: `questions[${indexById.get(question.id) ?? 0}]`,
        message: `Typeform does not support "${question.type}" questions.`,
        hint: `Use one of: ${Object.keys(TYPEFORM_FIELD_MAP).join(', ')}.`,
      });
    }
  });

  if (issues.length > 0) return { ok: false, issues };

  // Build fields
  const fields: TypeformField[] = [];

  questions.forEach((question) => {
    const typeformType = TYPEFORM_FIELD_MAP[question.type];
    if (!typeformType) return;

    const field: TypeformField = {
      // Typeform logic jumps address fields by ref, so every field needs a stable one.
      ref: fieldRef(question.id),
      title: question.title,
      type: typeformType,
      properties: {},
      validations: { required: question.required },
    };

    if (question.description) {
      field.properties = { ...field.properties, description: question.description };
    }

    if (question.type === 'multiple_choice' || question.type === 'dropdown' || question.type === 'checkboxes') {
      const choices = (question.options ?? []).map((value, index) => (
        question.type === 'dropdown'
          ? { label: value }
          : { ref: choiceRef(question.id, index), label: value }
      ));
      field.properties = {
        ...field.properties,
        choices,
        ...(question.type === 'dropdown' ? {} : { allow_multiple_selection: question.type === 'checkboxes' }),
        randomize: false,
      };
    }

    fields.push(field);
  });

  // Typeform has no sections. A visibility rule is expressed as a jump on the controlling
  // question: every answer other than the visible one skips the conditional questions. That only
  // works when the conditional group starts immediately after its controller and the question
  // after the group is always shown, so anything else is refused instead of built differently.
  const runs: VisibilityRun[] = [];
  questions.forEach((question, index) => {
    const condition = question.visibility?.when ?? null;
    const key = condition ? `${condition.question}\u0000${condition.equals}` : null;
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.end = index + 1;
    else runs.push({ start: index, end: index + 1, key, condition });
  });

  const actionsByController = new Map<string, TypeformLogicAction[]>();
  for (const run of runs) {
    if (!run.condition) continue;
    const sourceIndex = indexById.get(run.condition.question);
    if (sourceIndex === undefined) continue;
    const first = questions[run.start];
    const source = questions[sourceIndex];

    if (sourceIndex !== run.start - 1) {
      issues.push({
        code: 'typeform_condition_placement',
        path: `questions[${run.start}].visibility`,
        message: `"${first.id}" is shown only when "${source.id}" is answered, but Typeform can only skip ahead from the question immediately before a conditional group.`,
        hint: `Move "${first.id}" (and any questions with the same condition) directly after "${source.id}", or remove the visibility rule.`,
      });
      continue;
    }

    if (source.visibility) {
      issues.push({
        code: 'typeform_nested_condition',
        path: `questions[${run.start}].visibility`,
        message: `"${source.id}" controls other questions but is itself conditional. Typeform cannot chain conditions this way.`,
        hint: `Remove the visibility rule from "${source.id}", or make "${first.id}" depend on a question that is always shown.`,
      });
      continue;
    }

    if (source.type !== 'multiple_choice' && source.type !== 'dropdown' && source.type !== 'checkboxes') {
      issues.push({
        code: 'typeform_condition_source',
        path: `questions[${run.start}].visibility`,
        message: `Typeform can only branch on a multiple-choice, checkbox, or dropdown question, but "${source.id}" is ${source.type}.`,
        hint: `Use one of those question types for "${source.id}", or remove the visibility rule.`,
      });
      continue;
    }

    const next = questions[run.end];
    if (next?.visibility) {
      issues.push({
        code: 'typeform_condition_placement',
        path: `questions[${run.start}].visibility`,
        message: `"${first.id}" starts a conditional group directly before another conditional group. Typeform cannot skip both reliably.`,
        hint: `Put an always-shown question between the groups, or give them the same condition.`,
      });
      continue;
    }

    let condition: TypeformLogicCondition;
    if (source.type === 'dropdown') {
      condition = {
        op: 'not_equal',
        vars: [
          { type: 'field', value: fieldRef(source.id) },
          { type: 'constant', value: run.condition.equals },
        ],
      };
    } else {
      const choiceIndex = (source.options ?? []).indexOf(run.condition.equals);
      if (choiceIndex < 0) continue;
      condition = {
        op: 'is_not',
        vars: [
          { type: 'field', value: fieldRef(source.id) },
          { type: 'choice', value: choiceRef(source.id, choiceIndex) },
        ],
      };
    }

    const to = next
      ? { type: 'field' as const, value: fieldRef(next.id) }
      : { type: 'thankyou' as const, value: 'thankyou' };
    const action: TypeformLogicAction = { action: 'jump', condition, details: { to } };
    const existing = actionsByController.get(fieldRef(source.id));
    if (existing) existing.push(action);
    else actionsByController.set(fieldRef(source.id), [action]);
  }

  if (issues.length > 0) return { ok: false, issues };

  const logic: TypeformLogic[] = [...actionsByController].map(([ref, actions]) => ({ type: 'field', ref, actions }));

  const settings: TypeformSettings = {
    language: 'en',
    is_public: true,
    autosave_progress: true,
    progress_bar: 'percentage',
    show_typeform_branding: true,
    meta: { allow_indexing: false },
  };

  const welcomeScreens: TypeformWelcomeScreen[] = [{
    ref: 'welcome',
    title: specification.title,
    properties: { show_button: true, button_text: 'Start', description: specification.description },
  }];

  const thankYouScreens: TypeformThankYouScreen[] = [{
    ref: 'thankyou',
    title: 'Thank you!',
    properties: { show_button: false },
  }];

  const warnings: FormWarning[] = [];

  return {
    ok: true,
    plan: { title: specification.title, settings, fields, logic, welcomeScreens, thankYouScreens, warnings },
  };
}

export function buildTypeformFields(plan: TypeformPlan): TypeformField[] {
  return plan.fields;
}