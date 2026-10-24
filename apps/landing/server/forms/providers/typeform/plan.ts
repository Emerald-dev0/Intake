import type { FormWarning, ValidationIssue } from '../../../../src/lib/forms';
import type { FormSpecification, QuestionType } from '../../specification';
import { TypeformField, TypeformFieldType, TypeformLogic, TypeformSettings, TypeformTheme, TypeformWelcomeScreen, TypeformThankYouScreen } from './client';

export interface TypeformPlan {
  title: string;
  settings: TypeformSettings;
  theme: TypeformTheme;
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
      const choices = (question.options ?? []).map((value) => ({ label: value }));
      field.properties = { ...field.properties, choices, allowMultiple: question.type === 'checkboxes', randomize: false };
    }

    if (question.type === 'dropdown') {
      field.properties = { ...field.properties, dropdown: true };
    }

    if (question.type === 'long_text') {
      field.properties = { ...field.properties, placeholder: '' };
    }

    if (question.type === 'email') {
      field.validations = { ...field.validations, email: true };
    }

    fields.push(field);
  });

  // Build logic for visibility rules (Typeform Logic Jumps)
  const logic: TypeformLogic[] = [];
  questions.forEach((question) => {
    const visibility = question.visibility;
    if (!visibility) return;

    const sourceIndex = indexById.get(visibility.when.question);
    if (sourceIndex === undefined) return;

    // Typeform logic: `ref` is the controller field, `to` is the field that follows the jump.
    logic.push({
      ref: fieldRef(visibility.when.question),
      type: 'field',
      actions: [{
        action: 'jump',
        details: {
          to: { type: 'field', value: fieldRef(question.id) },
          condition: { op: 'is', value: visibility.when.equals },
        },
      }],
    });
  });

  const settings: TypeformSettings = {
    language: 'en',
    isPublic: true,
    autosaveProgress: true,
    progressBar: 'percentage',
    showTypeformBranding: true,
    meta: { allowIndexing: false },
  };

  const theme: TypeformTheme = {
    id: 'default',
    name: 'Default',
    background: { hue: 0, brightness: 0.98, type: 'solid' },
    colors: {
      question: '#252525',
      answer: '#252525',
      button: '#252525',
      background: '#FFFFFF',
    },
    font: 'system_ui',
    hasTransparentButton: false,
  };

  const welcomeScreens: TypeformWelcomeScreen[] = [{
    ref: 'welcome',
    title: specification.title,
    properties: { showButton: true, buttonText: 'Start', description: specification.description },
  }];

  const thankYouScreens: TypeformThankYouScreen[] = [{
    ref: 'thankyou',
    title: 'Thank you!',
    properties: { showButton: false, buttonText: '', buttonMode: 'close' },
  }];

  const warnings: FormWarning[] = [];

  return {
    ok: true,
    plan: { title: specification.title, settings, theme, fields, logic, welcomeScreens, thankYouScreens, warnings },
  };
}

export function buildTypeformFields(plan: TypeformPlan): TypeformField[] {
  return plan.fields;
}