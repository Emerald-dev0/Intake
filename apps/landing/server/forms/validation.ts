import type { ValidationIssue } from '../../src/lib/forms';
import { FormEngineError } from './errors';
import {
  CHOICE_TYPES,
  QUESTION_TYPES,
  SINGLE_ANSWER_CHOICE_TYPES,
  SPEC_LIMITS,
  type FormSpecification,
  type QuestionSpecification,
  type QuestionType,
} from './specification';

/**
 * Provider-independent validation. Everything here is a pure function of the input: no network, no
 * database. A specification that fails produces structured issues and never reaches an adapter.
 *
 * Provider limits (what Google can and cannot express) are checked separately by the adapter's own
 * planning step, so this layer stays true for every provider.
 */

export type ValidationIssueCode =
  | 'specification_invalid'
  | 'invalid_type'
  | 'unknown_property'
  | 'title_required'
  | 'title_too_long'
  | 'description_too_long'
  | 'questions_required'
  | 'too_many_questions'
  | 'question_invalid'
  | 'question_id_required'
  | 'question_id_invalid'
  | 'duplicate_question_id'
  | 'question_title_required'
  | 'question_title_too_long'
  | 'question_type_required'
  | 'unsupported_question_type'
  | 'options_required'
  | 'options_not_allowed'
  | 'too_many_options'
  | 'option_invalid'
  | 'duplicate_option'
  | 'visibility_invalid'
  | 'unsupported_condition_operator'
  | 'unknown_question_reference'
  | 'self_reference'
  | 'forward_reference'
  | 'unsupported_condition_source'
  | 'unknown_option_reference'
  | 'too_many_issues';

export type SpecificationResult = { ok: true; specification: FormSpecification } | { ok: false; issues: ValidationIssue[] };

const MAX_ISSUES = 50;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const FORM_KEYS = ['title', 'description', 'questions'] as const;
const QUESTION_KEYS = ['id', 'title', 'description', 'type', 'required', 'options', 'visibility'] as const;

/** Near-misses worth a specific hint, mostly vocabulary from the README and the landing demo. */
const FORM_HINTS: Record<string, string> = {
  fields: 'Use "questions".',
  sections: 'Sections are not part of the specification. Intake creates the sections a provider needs when a question uses "visibility".',
  settings: 'Form settings are not part of the specification.',
  name: 'Use "title" for the form title.',
};
const QUESTION_HINTS: Record<string, string> = {
  label: 'Use "title" for the question text.',
  text: 'Use "title" for the question text.',
  question: 'Use "title" for the question text.',
  choices: 'Use "options".',
  values: 'Use "options".',
  answers: 'Use "options".',
  mandatory: 'Use "required".',
  isRequired: 'Use "required".',
  condition: 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
  conditions: 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
  showWhen: 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
  visibleWhen: 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
  logic: 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
  branching: 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
  when: 'Put "when" inside "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.',
};
/** Types that exist in the landing demo or the README but are not supported by the engine yet. */
const TYPE_HINTS: Record<string, string> = {
  single_choice: 'Use "multiple_choice" for one answer from a list, or "checkboxes" for several answers.',
  phone: 'Phone numbers are not a separate type yet. Use "short_text".',
  number: 'Numbers are not a separate type yet. Use "short_text".',
  date: 'Dates are not supported yet.',
  time: 'Times are not supported yet.',
  rating: 'Ratings are not supported yet.',
  file: 'File uploads are not supported.',
  paragraph: 'Use "long_text".',
  text: 'Use "short_text" or "long_text".',
  radio: 'Use "multiple_choice".',
  checkbox: 'Use "checkboxes".',
};

const validated = new WeakSet<object>();

/** True only for objects produced by parseFormSpecification. The registry is module-private. */
export function isValidatedSpecification(value: unknown): value is FormSpecification {
  return typeof value === 'object' && value !== null && validated.has(value);
}

/**
 * Adapters call this before doing anything else. A caller that already validated pays nothing; any
 * other caller is validated here, so an invalid specification can never cause a provider request.
 */
export function ensureValidatedSpecification(input: unknown): FormSpecification {
  if (isValidatedSpecification(input)) return input;
  const result = parseFormSpecification(input);
  if (!result.ok) {
    throw new FormEngineError({
      code: 'validation_failed',
      message: 'The form specification is not valid. Nothing was created.',
      issues: result.issues,
      outcome: 'not_created',
      retryable: false,
    });
  }
  return result.specification;
}

class IssueList {
  readonly items: ValidationIssue[] = [];

  add(code: ValidationIssueCode, path: string, message: string, hint?: string): void {
    if (this.items.length >= MAX_ISSUES) return;
    if (this.items.length === MAX_ISSUES - 1) {
      this.items.push({ code: 'too_many_issues', path: '', message: `More problems were found. Only the first ${MAX_ISSUES - 1} are listed. Fix these and validate again.` });
      return;
    }
    this.items.push(hint ? { code, path, message, hint } : { code, path, message });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/** Titles and options are single-line text: control characters and line breaks become spaces. */
function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Descriptions keep line breaks but lose other control characters and runaway blank lines. */
function cleanBlock(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeSegment(key: string): string {
  return key.replace(/[^A-Za-z0-9_$-]/g, '_').slice(0, 40) || '_';
}

function quoted(key: string): string {
  return JSON.stringify(key.length > 40 ? `${key.slice(0, 40)}…` : key);
}

function rejectUnknown(row: Record<string, unknown>, allowed: readonly string[], base: string, hints: Record<string, string>, issues: IssueList): void {
  for (const key of Object.keys(row)) {
    if (allowed.includes(key)) continue;
    const path = base ? `${base}.${safeSegment(key)}` : safeSegment(key);
    issues.add('unknown_property', path, `Unknown property ${quoted(key)}. Allowed properties: ${allowed.join(', ')}.`, Object.prototype.hasOwnProperty.call(hints, key) ? hints[key] : undefined);
  }
}

function listIds(ids: string[]): string {
  const shown = ids.slice(0, 20).join(', ');
  return ids.length > 20 ? `${shown}, and ${ids.length - 20} more` : shown;
}

function describeQuestion(id: string): string {
  return `"${id}"`;
}

interface ParsedEntry {
  /** The id as written, when it was well-formed. Used to resolve references even if the question failed. */
  id: string | null;
  question: QuestionSpecification | null;
}

export function parseFormSpecification(input: unknown): SpecificationResult {
  const issues = new IssueList();
  if (!isRecord(input)) {
    issues.add('specification_invalid', '', `The specification must be a JSON object with a "title" and a "questions" array, but it is ${describe(input)}.`);
    return { ok: false, issues: issues.items };
  }
  rejectUnknown(input, FORM_KEYS, '', FORM_HINTS, issues);

  const title = readLine(input.title, 'title', { max: SPEC_LIMITS.maxFormTitle, missing: 'title_required', tooLong: 'title_too_long', label: 'The form title' }, issues);
  const description = readBlock(input.description, 'description', SPEC_LIMITS.maxFormDescription, 'The form description', issues);

  const entries: ParsedEntry[] = [];
  const raw = input.questions;
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.add('questions_required', 'questions', Array.isArray(raw) ? 'The form needs at least one question.' : `"questions" must be an array of question objects, but it is ${absent(raw) ? 'missing' : describe(raw)}.`);
  } else if (raw.length > SPEC_LIMITS.maxQuestions) {
    issues.add('too_many_questions', 'questions', `A form can have at most ${SPEC_LIMITS.maxQuestions} questions. This one has ${raw.length}.`);
  } else {
    const firstIndexById = new Map<string, number>();
    raw.forEach((item, index) => {
      const entry = parseQuestion(item, index, firstIndexById, issues);
      entries.push(entry);
    });
    checkVisibility(entries, issues);
  }

  if (issues.items.length > 0 || title === null) return { ok: false, issues: issues.items };
  const specification: FormSpecification = {
    title,
    ...(description ? { description } : {}),
    questions: entries.map(entry => entry.question as QuestionSpecification),
  };
  deepFreeze(specification);
  validated.add(specification);
  return { ok: true, specification };
}

function readLine(
  value: unknown,
  path: string,
  options: { max: number; missing: ValidationIssueCode; tooLong: ValidationIssueCode; label: string },
  issues: IssueList,
): string | null {
  if (absent(value)) {
    issues.add(options.missing, path, `${options.label} is required.`, `Add a non-empty "${path.split('.').pop()}" string.`);
    return null;
  }
  if (typeof value !== 'string') {
    issues.add('invalid_type', path, `${options.label} must be text, but it is ${describe(value)}.`);
    return null;
  }
  const clean = cleanLine(value);
  if (!clean) {
    issues.add(options.missing, path, `${options.label} cannot be empty.`);
    return null;
  }
  if (clean.length > options.max) {
    issues.add(options.tooLong, path, `${options.label} can be at most ${options.max} characters. This one has ${clean.length}.`);
    return null;
  }
  return clean;
}

function readBlock(value: unknown, path: string, max: number, label: string, issues: IssueList): string | undefined {
  if (absent(value)) return undefined;
  if (typeof value !== 'string') {
    issues.add('invalid_type', path, `${label} must be text, but it is ${describe(value)}.`);
    return undefined;
  }
  const clean = cleanBlock(value);
  if (clean.length > max) {
    issues.add('description_too_long', path, `${label} can be at most ${max} characters. This one has ${clean.length}.`);
    return undefined;
  }
  return clean || undefined;
}

function parseQuestion(item: unknown, index: number, firstIndexById: Map<string, number>, issues: IssueList): ParsedEntry {
  const base = `questions[${index}]`;
  if (!isRecord(item)) {
    issues.add('question_invalid', base, `Each question must be an object, but this one is ${describe(item)}.`);
    return { id: null, question: null };
  }
  const before = issues.items.length;
  rejectUnknown(item, QUESTION_KEYS, base, QUESTION_HINTS, issues);

  // id
  let id: string | null = null;
  if (absent(item.id)) {
    issues.add('question_id_required', `${base}.id`, 'Every question needs an "id" so other questions can refer to it.', 'Use a short identifier such as "full_name".');
  } else if (typeof item.id !== 'string') {
    issues.add('invalid_type', `${base}.id`, `The question id must be text, but it is ${describe(item.id)}.`);
  } else {
    const candidate = item.id.trim();
    if (!candidate || candidate.length > SPEC_LIMITS.maxIdLength || !ID_PATTERN.test(candidate)) {
      issues.add('question_id_invalid', `${base}.id`, `The question id ${quoted(item.id)} is not valid. Ids start with a letter and contain only letters, digits, underscores and hyphens (at most ${SPEC_LIMITS.maxIdLength} characters).`);
    } else {
      id = candidate;
      const key = candidate.toLowerCase();
      const first = firstIndexById.get(key);
      if (first !== undefined) {
        issues.add('duplicate_question_id', `${base}.id`, `The question id "${candidate}" is already used by questions[${first}]. Every question needs a unique id (ids are compared without regard to capitalization).`);
      } else {
        firstIndexById.set(key, index);
      }
    }
  }

  const title = readLine(item.title, `${base}.title`, { max: SPEC_LIMITS.maxQuestionTitle, missing: 'question_title_required', tooLong: 'question_title_too_long', label: 'The question title' }, issues);
  const description = readBlock(item.description, `${base}.description`, SPEC_LIMITS.maxQuestionDescription, 'The question description', issues);

  // type
  let type: QuestionType | null = null;
  if (absent(item.type)) {
    issues.add('question_type_required', `${base}.type`, `Every question needs a "type". Supported types: ${QUESTION_TYPES.join(', ')}.`);
  } else if (typeof item.type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(item.type)) {
    const shown = typeof item.type === 'string' ? quoted(item.type) : describe(item.type);
    issues.add(
      'unsupported_question_type',
      `${base}.type`,
      `The question type ${shown} is not supported. Supported types: ${QUESTION_TYPES.join(', ')}.`,
      typeof item.type === 'string' && Object.prototype.hasOwnProperty.call(TYPE_HINTS, item.type) ? TYPE_HINTS[item.type] : undefined,
    );
  } else {
    type = item.type as QuestionType;
  }

  // required
  let required = false;
  if (!absent(item.required)) {
    if (typeof item.required === 'boolean') required = item.required;
    else issues.add('invalid_type', `${base}.required`, `"required" must be true or false, but it is ${describe(item.required)}.`);
  }

  const options = parseOptions(item.options, type, base, issues);
  const visibility = parseVisibility(item.visibility, base, issues);

  if (issues.items.length > before || !id || !title || !type) return { id, question: null };
  const question: QuestionSpecification = {
    id,
    title,
    ...(description ? { description } : {}),
    type,
    required,
    ...(options ? { options } : {}),
    ...(visibility ? { visibility } : {}),
  };
  return { id, question };
}

function parseOptions(value: unknown, type: QuestionType | null, base: string, issues: IssueList): string[] | undefined {
  const path = `${base}.options`;
  const isChoice = type !== null && CHOICE_TYPES.includes(type);
  if (type === null) return undefined;
  if (!isChoice) {
    // An empty list is a harmless artifact of generated output, so it is tolerated and dropped.
    if (absent(value) || (Array.isArray(value) && value.length === 0)) return undefined;
    issues.add('options_not_allowed', path, `A ${type} question cannot have options. Options are only for ${CHOICE_TYPES.join(', ')}.`, `Remove "options" or change the type to one that offers choices.`);
    return undefined;
  }
  if (absent(value) || (Array.isArray(value) && value.length === 0)) {
    issues.add('options_required', path, `A ${type} question needs at least one option, but ${absent(value) ? 'options are missing' : 'the options list is empty'}.`, 'Add an "options" array of strings, for example ["Yes", "No"].');
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.add('invalid_type', path, `"options" must be an array of strings, but it is ${describe(value)}.`);
    return undefined;
  }
  if (value.length > SPEC_LIMITS.maxOptions) {
    issues.add('too_many_options', path, `A question can have at most ${SPEC_LIMITS.maxOptions} options. This one has ${value.length}.`);
    return undefined;
  }
  const seen = new Map<string, number>();
  const clean: string[] = [];
  let ok = true;
  value.forEach((option, position) => {
    const optionPath = `${path}[${position}]`;
    if (typeof option !== 'string') {
      issues.add('option_invalid', optionPath, `Each option must be text, but this one is ${describe(option)}.`);
      ok = false;
      return;
    }
    const text = cleanLine(option);
    if (!text) {
      issues.add('option_invalid', optionPath, 'An option cannot be empty.');
      ok = false;
      return;
    }
    if (text.length > SPEC_LIMITS.maxOptionLength) {
      issues.add('option_invalid', optionPath, `An option can be at most ${SPEC_LIMITS.maxOptionLength} characters. This one has ${text.length}.`);
      ok = false;
      return;
    }
    const key = text.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      issues.add('duplicate_option', optionPath, `The option ${quoted(text)} repeats options[${first}]. Options must be different from each other.`);
      ok = false;
      return;
    }
    seen.set(key, position);
    clean.push(text);
  });
  return ok ? clean : undefined;
}

function parseVisibility(value: unknown, base: string, issues: IssueList): { when: { question: string; equals: string } } | undefined {
  if (absent(value)) return undefined;
  const path = `${base}.visibility`;
  const shape = 'Use "visibility": { "when": { "question": "<id>", "equals": "<option>" } }.';
  if (!isRecord(value)) {
    issues.add('visibility_invalid', path, `"visibility" must be an object, but it is ${describe(value)}.`, shape);
    return undefined;
  }
  rejectUnknown(value, ['when'], path, {}, issues);
  if (!isRecord(value.when)) {
    issues.add('visibility_invalid', `${path}.when`, '"visibility" needs a "when" object naming the controlling question and the answer.', shape);
    return undefined;
  }
  const when = value.when;
  const operators = Object.keys(when).filter(key => key !== 'question' && key !== 'equals');
  for (const key of operators) {
    issues.add(
      'unsupported_condition_operator',
      `${path}.when.${safeSegment(key)}`,
      `The condition ${quoted(key)} is not supported. Only "equals" is supported.`,
      'Conditions compare a single-answer question with one of its exact options.',
    );
  }
  let question: string | null = null;
  if (typeof when.question !== 'string' || !when.question.trim()) {
    issues.add('visibility_invalid', `${path}.when.question`, '"when.question" must be the id of an earlier question.', shape);
  } else {
    question = when.question.trim();
  }
  let equals: string | null = null;
  if (typeof when.equals !== 'string' || !cleanLine(when.equals)) {
    if (operators.length === 0) issues.add('visibility_invalid', `${path}.when.equals`, '"when.equals" must be one of the controlling question\'s options.', shape);
  } else {
    equals = cleanLine(when.equals);
  }
  if (operators.length > 0 || !question || equals === null) return undefined;
  return { when: { question, equals } };
}

function checkVisibility(entries: ParsedEntry[], issues: IssueList): void {
  const exact = new Map<string, number>();
  const folded = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!entry.id) return;
    if (!exact.has(entry.id)) exact.set(entry.id, index);
    if (!folded.has(entry.id.toLowerCase())) folded.set(entry.id.toLowerCase(), index);
  });
  const knownIds = entries.map(entry => entry.id).filter((id): id is string => id !== null);

  entries.forEach((entry, index) => {
    const rule = entry.question?.visibility;
    if (!entry.question || !rule) return;
    const path = `questions[${index}].visibility.when`;
    const target = exact.get(rule.when.question);
    if (target === undefined) {
      const near = folded.get(rule.when.question.toLowerCase());
      const suggestion = near !== undefined ? entries[near].id : null;
      issues.add(
        'unknown_question_reference',
        `${path}.question`,
        `${describeQuestion(entry.question.id)} is shown only when question ${quoted(rule.when.question)} is answered, but no question has that id.`,
        suggestion ? `Did you mean "${suggestion}"? Ids are case-sensitive.` : `Known question ids: ${listIds(knownIds)}.`,
      );
      return;
    }
    if (target === index) {
      issues.add('self_reference', `${path}.question`, `${describeQuestion(entry.question.id)} cannot depend on its own answer.`);
      return;
    }
    if (target > index) {
      issues.add(
        'forward_reference',
        `${path}.question`,
        `${describeQuestion(entry.question.id)} depends on "${rule.when.question}", which comes later in the form. Respondents answer questions in order, so a question can only depend on an earlier one.`,
        `Move "${rule.when.question}" above "${entry.question.id}" or move "${entry.question.id}" below it.`,
      );
      return;
    }
    const source = entries[target].question;
    if (!source) return; // the source already has its own problems reported
    if (!SINGLE_ANSWER_CHOICE_TYPES.includes(source.type)) {
      issues.add(
        'unsupported_condition_source',
        `${path}.question`,
        `${describeQuestion(entry.question.id)} depends on "${source.id}", which is a ${source.type} question. A condition can only depend on a question with a single answer: ${SINGLE_ANSWER_CHOICE_TYPES.join(' or ')}.`,
        source.type === 'checkboxes' ? 'Checkboxes allow several answers at once, so there is no single answer to compare against.' : undefined,
      );
      return;
    }
    const options = source.options ?? [];
    if (!options.includes(rule.when.equals)) {
      const near = options.find(option => option.toLowerCase() === rule.when.equals.toLowerCase());
      issues.add(
        'unknown_option_reference',
        `${path}.equals`,
        `${describeQuestion(entry.question.id)} is shown when "${source.id}" equals ${quoted(rule.when.equals)}, but that is not one of its options (${options.map(option => quoted(option)).join(', ')}).`,
        near ? `Did you mean ${quoted(near)}? Options are case-sensitive.` : undefined,
      );
    }
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
