import { CHOICE_TYPES, SPEC_LIMITS, type QuestionSpecification, type QuestionType } from '../../src/lib/specification';
import type { FormEditOperation, FormEditSnapshot, FormEditPlan, QuestionEditChanges } from '../../src/lib/form-edit';
import { parseFormSpecification } from './validation';

export interface EditPlanIssue { code: string; path: string; message: string; hint?: string }
export type EditPlanValidation = { ok: true; plan: FormEditPlan; expected: ExpectedFormState } | { ok: false; kind: 'invalid' | 'unsupported'; issues: EditPlanIssue[] };

export interface ExpectedFormState {
  title: string;
  description: string;
  /** Existing item ids remain stable. Added placeholders are local and never sent to Google. */
  items: { key: string; question?: QuestionSpecification; existingItem?: FormEditSnapshot['items'][number] }[];
}

const QUESTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATION_TYPES = ['update_title', 'update_description', 'add_question', 'update_question', 'delete_question', 'move_question'] as const;
function isOperationType(value: string): value is FormEditOperation['type'] { return (OPERATION_TYPES as readonly string[]).includes(value); }
const CHANGE_KEYS = ['title', 'description', 'type', 'required', 'options'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function addIssue(issues: EditPlanIssue[], code: string, path: string, message: string, hint?: string): void {
  issues.push({ code, path, message, ...(hint ? { hint } : {}) });
}
function safeText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
}
function qType(value: unknown): value is Exclude<QuestionType, 'email'> {
  return typeof value === 'string' && ['short_text', 'long_text', 'multiple_choice', 'dropdown', 'checkboxes'].includes(value);
}
function cleanDescription(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeQuestion(input: unknown, id: string, path: string, issues: EditPlanIssue[]): QuestionSpecification | null {
  if (!isRecord(input)) {
    addIssue(issues, 'question_invalid', path, 'A new question must be an object.');
    return null;
  }
  const allowed = ['title', 'description', 'type', 'required', 'options'];
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    addIssue(issues, 'unknown_property', path, 'A question contains unsupported properties.');
    return null;
  }
  const type = input.type;
  const candidate: Record<string, unknown> = {
    id,
    title: input.title,
    type,
    required: input.required,
    options: input.options,
    ...(input.description !== null ? { description: input.description } : {}),
  };
  if (input.description !== null && input.description !== undefined && !safeText(input.description, SPEC_LIMITS.maxQuestionDescription, true)) {
    addIssue(issues, 'question_description_invalid', `${path}.description`, `Question description must be at most ${SPEC_LIMITS.maxQuestionDescription} characters.`);
    return null;
  }
  if (!qType(type)) {
    addIssue(issues, 'unsupported_question_type', `${path}.type`, 'Google edit operations support short answer, paragraph, multiple choice, dropdown, and checkboxes. Email format validation is not available through the Forms API.');
    return null;
  }
  const parsed = parseFormSpecification({ title: 'Edit validation', questions: [candidate] });
  if (!parsed.ok) {
    for (const issue of parsed.issues.slice(0, 10)) addIssue(issues, issue.code, `${path}.${issue.path.replace(/^questions\[0\]\.?/, '')}`, issue.message, issue.hint);
    return null;
  }
  return parsed.specification.questions[0];
}

function parseOperation(value: unknown, index: number, current: FormEditSnapshot, issues: EditPlanIssue[]): FormEditOperation | null {
  const path = `operations[${index}]`;
  if (!isRecord(value) || typeof value.type !== 'string' || !isOperationType(value.type)) {
    addIssue(issues, 'unsupported_edit_operation', path, 'This edit operation is not supported. Intake will not approximate it.');
    return null;
  }
  const op = value.type;
  if (op === 'update_title') {
    if (Object.keys(value).some(key => !['type', 'title'].includes(key)) || !safeText(value.title, SPEC_LIMITS.maxFormTitle)) {
      addIssue(issues, 'invalid_title_update', `${path}.title`, `The new title must be non-empty and at most ${SPEC_LIMITS.maxFormTitle} characters.`);
      return null;
    }
    return { type: op, title: value.title.trim() };
  }
  if (op === 'update_description') {
    if (Object.keys(value).some(key => !['type', 'description'].includes(key)) || !safeText(value.description, SPEC_LIMITS.maxFormDescription, true)) {
      addIssue(issues, 'invalid_description_update', `${path}.description`, `The description must be text no longer than ${SPEC_LIMITS.maxFormDescription} characters.`);
      return null;
    }
    return { type: op, description: cleanDescription(value.description) };
  }
  if (op === 'add_question') {
    if (Object.keys(value).some(key => !['type', 'question', 'position'].includes(key)) ||
        (value.position !== null && value.position !== undefined && (!Number.isSafeInteger(value.position) || (value.position as number) < 0))) {
      addIssue(issues, 'invalid_add_question', path, 'A new question has an invalid position or unsupported properties.');
      return null;
    }
    const question = normalizeQuestion(value.question, `added_${index + 1}`, `${path}.question`, issues);
    if (!question) return null;
    return { type: op, question: { title: question.title, type: question.type as Exclude<QuestionType, 'email'>,
      ...(question.description ? { description: question.description } : {}), required: question.required,
      ...(question.options ? { options: question.options } : {}) },
      ...(Number.isSafeInteger(value.position) ? { position: value.position as number } : {}) };
  }
  const questionId = value.questionId;
  const target = typeof questionId === 'string' && QUESTION_ID.test(questionId) ? current.items.find(item => item.questionId === questionId) : undefined;
  if (!target) {
    addIssue(issues, 'unknown_question_id', `${path}.questionId`, 'The target is not a question ID from the current Google Form. Intake cannot guess a replacement target.');
    return null;
  }
  if (op === 'delete_question') {
    if (Object.keys(value).some(key => !['type', 'questionId'].includes(key))) {
      addIssue(issues, 'invalid_delete_question', path, 'A delete operation must identify exactly one existing question.');
      return null;
    }
    if (!target.capabilities.includes('delete')) addIssue(issues, 'unsupported_delete', path, `Google Forms cannot safely delete “${target.title}” through Intake because it is part of a section or conditional structure.`, 'Open the original form in Google Forms to make this structural change.');
    return { type: op, questionId: questionId as string };
  }
  if (op === 'move_question') {
    if (Object.keys(value).some(key => !['type', 'questionId', 'position'].includes(key)) || !Number.isSafeInteger(value.position) || (value.position as number) < 0) {
      addIssue(issues, 'invalid_move_position', `${path}.position`, 'A move must specify a non-negative item position.');
      return null;
    }
    if (!target.capabilities.includes('move')) addIssue(issues, 'unsupported_move', path, `Intake cannot safely move “${target.title}” in this form’s current structure or scoring setup.`, 'Open the original form in Google Forms to change its layout.');
    return { type: op, questionId: questionId as string, position: value.position as number };
  }
  if (Object.keys(value).some(key => !['type', 'questionId', 'changes'].includes(key)) || !isRecord(value.changes)) {
    addIssue(issues, 'invalid_question_update', path, 'An update must include a question ID and a changes object.');
    return null;
  }
  const rawChanges = value.changes;
  if (Object.keys(rawChanges).some(key => !(CHANGE_KEYS as readonly string[]).includes(key))) {
    addIssue(issues, 'unknown_question_change', `${path}.changes`, 'The update contains a property that is not supported.');
    return null;
  }
  const changes: QuestionEditChanges = {};
  if (rawChanges.title !== null && rawChanges.title !== undefined) {
    if (!safeText(rawChanges.title, SPEC_LIMITS.maxQuestionTitle)) addIssue(issues, 'invalid_question_title', `${path}.changes.title`, `Question title must be non-empty and at most ${SPEC_LIMITS.maxQuestionTitle} characters.`);
    else changes.title = rawChanges.title.trim();
  }
  if (rawChanges.description !== null && rawChanges.description !== undefined) {
    if (!safeText(rawChanges.description, SPEC_LIMITS.maxQuestionDescription, true)) addIssue(issues, 'invalid_question_description', `${path}.changes.description`, `Question description must be at most ${SPEC_LIMITS.maxQuestionDescription} characters.`);
    else changes.description = cleanDescription(rawChanges.description);
  }
  if (rawChanges.required !== null && rawChanges.required !== undefined) {
    if (typeof rawChanges.required !== 'boolean') addIssue(issues, 'invalid_required', `${path}.changes.required`, 'Required must be true or false.');
    else changes.required = rawChanges.required;
  }
  if (rawChanges.type !== null && rawChanges.type !== undefined) {
    if (!qType(rawChanges.type)) addIssue(issues, 'unsupported_question_type', `${path}.changes.type`, 'This question type is not supported by Intake.');
    else changes.type = rawChanges.type;
  }
  if (rawChanges.options !== null && rawChanges.options !== undefined) {
    if (!Array.isArray(rawChanges.options) || !rawChanges.options.every(option => typeof option === 'string')) addIssue(issues, 'invalid_options', `${path}.changes.options`, 'Question options must be an array of text values.');
    else changes.options = rawChanges.options as string[];
  }
  if (Object.keys(changes).length === 0) addIssue(issues, 'empty_question_update', `${path}.changes`, 'An update needs at least one change.');
  if (issues.some(issue => issue.path.startsWith(path))) return null;
  const nextType = changes.type ?? (qType(target.questionType) ? target.questionType : null);
  const nextOptions = changes.options ?? target.options;
  if (nextType && CHOICE_TYPES.includes(nextType) && (!nextOptions || nextOptions.length === 0)) {
    addIssue(issues, 'options_required', `${path}.changes.options`, `A ${nextType} question needs at least one option.`);
    return null;
  }
  if (nextType && !CHOICE_TYPES.includes(nextType) && changes.options && changes.options.length > 0) {
    addIssue(issues, 'options_not_allowed', `${path}.changes.options`, `A ${nextType} question cannot have answer options.`);
    return null;
  }
  const unsupportedField = (changes.title !== undefined && !target.capabilities.includes('update_title')) ||
    (changes.description !== undefined && !target.capabilities.includes('update_description')) ||
    (changes.required !== undefined && !target.capabilities.includes('update_required')) ||
    (changes.type !== undefined && !target.capabilities.includes('update_type')) ||
    (changes.options !== undefined && !target.capabilities.includes('update_options'));
  if (unsupportedField) {
    addIssue(issues, 'unsupported_question_mutation', path, `Google Forms cannot safely apply those changes to “${target.title}” while preserving its existing question settings.`, 'Change a supported item or edit this question directly in Google Forms.');
    return null;
  }
  const synthetic = normalizeQuestion({ title: changes.title ?? target.title, description: changes.description ?? target.description ?? null,
    type: nextType ?? 'short_text', required: changes.required ?? target.required ?? false,
    options: nextOptions ?? [] }, `existing_${index + 1}`, `${path}.changes`, issues);
  if (!synthetic) return null;
  if (changes.required === false && target.hasRouting) addIssue(issues, 'unsupported_routing_controller_optional', `${path}.changes.required`, `“${target.title}” controls Google Forms section routing and cannot be made optional without changing the form's behavior.`);
  return { type: op, questionId: questionId as string, changes };
}

function questionFor(item: FormEditSnapshot['items'][number]): QuestionSpecification | null {
  if (!item.questionId || !item.questionType || !qType(item.questionType)) return null;
  const type = qType(item.questionType) ? item.questionType : 'short_text';
  const result = parseFormSpecification({ title: 'Existing form', questions: [{ id: 'existing_question', title: item.title || 'Question', type,
    required: item.required ?? false, ...(item.description ? { description: item.description } : {}),
    ...(CHOICE_TYPES.includes(type) && item.options ? { options: item.options } : {}) }] });
  return result.ok ? result.specification.questions[0] : null;
}

function sectionAtInsertion(items: ExpectedFormState['items'], position: number): number {
  let section = 0;
  for (let i = 0; i < Math.min(position, items.length); i += 1) if (items[i].existingItem?.kind === 'section') section += 1;
  return section;
}

/**
 * Semantic validation against fresh provider state. The plan cannot invent targets, provider ids,
 * operations, or capabilities. `expected` is only an in-memory reconciliation model; Google remains
 * the source of truth.
 */
export function validateFormEditPlan(current: FormEditSnapshot, raw: unknown): EditPlanValidation {
  const issues: EditPlanIssue[] = [];
  if (!isRecord(raw) || Object.keys(raw).some(key => !['summary', 'operations'].includes(key)) || !safeText(raw.summary, 500) ||
      !Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > 20) {
    return { ok: false, kind: 'invalid', issues: [{ code: 'edit_plan_invalid', path: '', message: 'The edit plan is incomplete or has unsupported properties. No changes were made.' }] };
  }
  const operations: FormEditOperation[] = [];
  raw.operations.forEach((operation, index) => {
    const parsed = parseOperation(operation, index, current, issues);
    if (parsed) operations.push(parsed);
  });
  if (issues.length) return { ok: false, kind: issues.some(issue => issue.code.startsWith('unsupported_')) ? 'unsupported' : 'invalid', issues };

  const formMeta = new Set<string>();
  const questionActions = new Map<string, Set<string>>();
  for (const [index, operation] of operations.entries()) {
    if (operation.type === 'update_title' || operation.type === 'update_description') {
      if (formMeta.has(operation.type)) addIssue(issues, 'duplicate_form_update', `operations[${index}]`, `The form ${operation.type === 'update_title' ? 'title' : 'description'} is changed more than once.`);
      formMeta.add(operation.type);
    }
    if ('questionId' in operation) {
      const kinds = questionActions.get(operation.questionId) ?? new Set<string>();
      const action = operation.type;
      if (kinds.has(action) || (action === 'delete_question' && kinds.size > 0) || (kinds.has('delete_question'))) {
        addIssue(issues, 'conflicting_question_operations', `operations[${index}]`, 'The plan contains duplicate or conflicting changes to the same question. Combine property changes into one update or revise the plan.');
      }
      kinds.add(action);
      questionActions.set(operation.questionId, kinds);
    }
  }
  if (issues.length) return { ok: false, kind: 'invalid', issues };

  const items: ExpectedFormState['items'] = current.items.map(item => ({ key: item.itemId, existingItem: item, ...(questionFor(item) ? { question: questionFor(item)! } : {}) }));
  let title = current.title;
  let description = current.description ?? '';
  let structuralCount = 0;

  for (const [index, operation] of operations.entries()) {
    const path = `operations[${index}]`;
    if (operation.type === 'update_title') {
      if (operation.title === title) addIssue(issues, 'no_op', path, 'The proposed title is already current.');
      title = operation.title;
    } else if (operation.type === 'update_description') {
      if (operation.description === description) addIssue(issues, 'no_op', path, 'The proposed description is already current.');
      description = operation.description;
    } else if (operation.type === 'add_question') {
      structuralCount += 1;
      const position = operation.position ?? items.length;
      if (position > items.length) {
        addIssue(issues, 'position_invalid', `${path}.position`, `Add position must be between 0 and ${items.length} at this step in the plan.`);
        continue;
      }
      const normalized = normalizeQuestion(operation.question, `added_${index + 1}`, `${path}.question`, issues);
      if (!normalized) continue;
      const key = `new:${index}`;
      items.splice(position, 0, { key, question: normalized });
    } else if (operation.type === 'delete_question') {
      structuralCount += 1;
      const item = current.items.find(candidate => candidate.questionId === operation.questionId);
      const position = items.findIndex(candidate => candidate.existingItem?.questionId === operation.questionId);
      if (!item || position < 0) {
        addIssue(issues, 'unknown_question_id', `${path}.questionId`, 'The target question is not present in the current form.');
        continue;
      }
      items.splice(position, 1);
    } else if (operation.type === 'move_question') {
      structuralCount += 1;
      const position = items.findIndex(candidate => candidate.existingItem?.questionId === operation.questionId);
      if (position < 0) {
        addIssue(issues, 'unknown_question_id', `${path}.questionId`, 'The target question is not present at this step in the plan.');
        continue;
      }
      const [moved] = items.splice(position, 1);
      if (operation.position >= items.length) {
        // The last valid index after removal is items.length; index==length means append, which is valid.
        if (operation.position > items.length) {
          addIssue(issues, 'position_invalid', `${path}.position`, `Move position must be between 0 and ${items.length} after removing the question.`);
          items.splice(position, 0, moved);
          continue;
        }
      }
      const sourceSection = moved.existingItem?.sectionIndex;
      const destinationSection = sectionAtInsertion(items, operation.position);
      if (sourceSection !== undefined && sourceSection !== destinationSection) {
        addIssue(issues, 'position_crosses_section', `${path}.position`, 'A question can only be moved within its existing section.');
        items.splice(position, 0, moved);
        continue;
      }
      if (position === operation.position) addIssue(issues, 'no_op', path, 'The question is already in that position.');
      items.splice(operation.position, 0, moved);
    } else if (operation.type === 'update_question') {
      const itemIndex = items.findIndex(candidate => candidate.existingItem?.questionId === operation.questionId);
      const item = itemIndex >= 0 ? items[itemIndex] : undefined;
      const before = item?.question;
      if (!item || !before) {
        addIssue(issues, 'question_type_unsupported', path, 'This question type is not supported for the requested update.');
        continue;
      }
      const changes = operation.changes;
      const type = changes.type ?? before.type;
      const options = changes.options ?? before.options;
      const next = normalizeQuestion({ title: changes.title ?? before.title, description: changes.description ?? before.description ?? null,
        type, required: changes.required ?? before.required ?? false, options: options ?? [] }, `existing_${index + 1}`, `${path}.changes`, issues);
      if (!next) continue;
      const changed = Object.keys(changes).some(key => {
        const value = changes[key as keyof typeof changes];
        if (key === 'description') return value !== (before.description ?? '');
        if (key === 'options') return JSON.stringify(value) !== JSON.stringify(before.options ?? []);
        return value !== before[key as keyof QuestionSpecification];
      });
      if (!changed) addIssue(issues, 'no_op', path, 'The requested question already has these values.');
      if (item.existingItem?.hasRouting && changes.required === false) addIssue(issues, 'unsupported_routing_controller_optional', `${path}.changes.required`, 'A question used for section routing cannot safely be made optional.');
      item.question = next;
    }
  }

  const remainingQuestions = items.filter(item => item.question || item.existingItem?.kind === 'question').length;
  if (remainingQuestions < 1) addIssue(issues, 'questions_required', 'operations', 'The plan would remove every question. Keep at least one question in the form.');
  if (structuralCount > 0 && current.isQuiz) {
    addIssue(issues, 'unsupported_quiz_structure', 'operations', 'Adding, removing, or moving questions in a quiz is not supported because it could change grading and scoring behavior.', 'Make the structural change directly in Google Forms, or ask Intake to update a supported question property.');
  }
  if (structuralCount > 0 && current.hasBranching) {
    addIssue(issues, 'unsupported_branching_structure', 'operations', 'Adding, removing, or moving items in a form with section routing is not supported yet. This plan could change how respondents navigate the form.', 'Update a question title, help text, or required setting instead, or edit the layout directly in Google Forms.');
  }
  if (issues.length) return { ok: false, kind: issues.some(issue => issue.code.startsWith('unsupported_')) ? 'unsupported' : 'invalid', issues };
  return { ok: true, plan: { formId: current.providerFormId, summary: raw.summary.trim(), operations }, expected: { title, description, items } };
}

export function applyOperationsToSnapshot(current: FormEditSnapshot, operations: FormEditOperation[]): ExpectedFormState {
  const raw = { summary: 'Revalidated edit plan', operations: operations.map(operation => operation.type === 'add_question'
    ? { ...operation, question: { ...operation.question, description: operation.question.description ?? null, required: operation.question.required ?? false, options: operation.question.options ?? [] } }
    : operation.type === 'update_question' ? { ...operation, changes: { title: null, description: null, type: null, required: null, options: null, ...operation.changes } }
      : operation) };
  const validated = validateFormEditPlan(current, raw);
  if (!validated.ok) throw new Error('Stored form edit plan failed fresh validation');
  return validated.expected;
}

export function editPlanFailure(validation: Extract<EditPlanValidation, { ok: false }>): { code: 'edit_plan_invalid' | 'edit_unsupported'; message: string; issues: EditPlanIssue[] } {
  const messages = validation.issues.slice(0, 4).map(issue => issue.message);
  return {
    code: validation.kind === 'unsupported' ? 'edit_unsupported' : 'edit_plan_invalid',
    message: messages.join(' ') || 'The proposed changes did not pass validation. Nothing was changed.',
    issues: validation.issues,
  };
}

export function isEditableQuestionType(value: unknown): value is Exclude<QuestionType, 'email'> {
  return qType(value);
}
