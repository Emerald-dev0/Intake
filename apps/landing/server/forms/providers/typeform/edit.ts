import type { EditCapability, FormEditItem, FormEditPlan, FormEditSnapshot, NewEditQuestion } from '../../../../src/lib/form-edit';
import type { QuestionType } from '../../specification';
import { safeFormUrl } from '../../../../src/lib/forms';
import { editLimitText } from '../../../../src/lib/edit-limits';
import type { TypeformField, TypeformFormResource, TypeformFieldType, TypeformLogic, TypeformSettings, TypeformWelcomeScreen, TypeformThankYouScreen } from './client';

/**
 * Typeform editing, as a pure read-modify-write.
 *
 * Typeform has no operation API. `PATCH /forms/{id}` only reaches form-level properties (title,
 * settings, theme, workspace); Typeform's own FAQ says there is no endpoint that changes a single
 * question, and the community answer is uniform: retrieve the whole form, change it, `PUT` it back.
 * A `PUT` **overwrites**: every field you leave out is deleted, together with the answers already
 * collected for it, and a theme you omit is silently replaced by a fresh copy of the default.
 *
 * That makes the payload the safety mechanism. Nothing here is built from a stored snapshot or from
 * the model: the caller retrieves the live form, and `compileTypeformEdit` deep-copies that exact
 * resource and touches only the properties named by the plan. Settings, logic jumps, welcome and
 * thank-you screens, theme, workspace and every untouched field are echoed back byte-for-byte.
 *
 * What Intake refuses to do on Typeform, and why:
 * - **Delete a question.** Deleting a field discards its responses, and Intake does not request the
 *   `responses:read` scope, so it cannot check whether answers exist. Refusing is the only honest
 *   option; the person can delete it in Typeform, where the count is visible.
 * - **Change a question's type.** Typeform cannot retype a field in place; a `PUT` with a new type
 *   for an existing id either fails or behaves like a new field. Answers would be orphaned.
 * - **Reorder fields while logic jumps exist.** Jumps address fields by ref, so order is part of the
 *   flow. With logic present, a "move" can silently change which question a respondent sees next.
 *
 * This module is pure: no network, no clock, no randomness.
 */

/** Typeform types Intake's editor vocabulary can represent. Everything else is shown read-only. */
const EDITABLE_TYPES: ReadonlySet<string> = new Set(['short_text', 'long_text', 'email', 'number', 'date', 'multiple_choice', 'dropdown', 'picture_choice', 'yes_no', 'rating', 'opinion_scale', 'website']);

/** Types whose `properties.choices` are a real option list Intake may rewrite. */
const CHOICE_TYPES: ReadonlySet<string> = new Set(['multiple_choice', 'dropdown', 'picture_choice']);

/** Types that have no `title` a person would edit (they are layout, not questions). */
const UNTITLED_TYPES: ReadonlySet<string> = new Set(['group', 'payment', 'calendly']);

const CREATABLE: Record<Exclude<QuestionType, 'email'>, TypeformFieldType> = {
  short_text: 'short_text',
  long_text: 'long_text',
  multiple_choice: 'multiple_choice',
  dropdown: 'dropdown',
  // Typeform's multi-select is `multiple_choice` with `allowMultiple`, exactly as creation writes it.
  checkboxes: 'multiple_choice',
};

export interface TypeformEditCompilation {
  /** Exactly what goes to `PUT /forms/{id}`. Never contains ids, links, timestamps or workspaces. */
  payload: TypeformEditPayload;
  /** What the form must look like afterwards; `verifyTypeformEdit` compares against this. */
  expected: FormEditSnapshot;
}

export interface TypeformEditPayload {
  title: string;
  fields: TypeformField[];
  settings: TypeformSettings;
  theme?: { href: string };
  welcome_screens: TypeformWelcomeScreen[];
  thankyou_screens: TypeformThankYouScreen[];
  logic: TypeformLogic[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isChoiceType(type: string): boolean {
  return CHOICE_TYPES.has(type);
}

/** The visible description of a Typeform lives on its welcome screen, not on the form. */
function welcomeDescription(resource: TypeformFormResource): string | undefined {
  const description = resource.welcomeScreens?.[0]?.properties?.description;
  return typeof description === 'string' && description.length > 0 ? description : undefined;
}

function itemIdOf(field: TypeformField, index: number): string {
  return field.ref ?? field.id ?? `field_${index}`;
}

/**
 * A normalized, read-only view of the live form. Capabilities are conservative on purpose: they are
 * what the proposal language and the UI use to decide what a person may even ask for.
 */
export function typeformEditSnapshot(resource: TypeformFormResource): FormEditSnapshot {
  const editUrl = `https://admin.typeform.com/form/${encodeURIComponent(resource.id)}/edit`;
  const responderUrl = safeFormUrl(resource._links?.display);
  const hasLogic = Array.isArray(resource.logic) && resource.logic.length > 0;
  const items: FormEditItem[] = (resource.fields ?? []).map((field, index) => {
    const type = String(field.type);
    const editable = EDITABLE_TYPES.has(type);
    const capabilities: EditCapability[] = [];
    if (!UNTITLED_TYPES.has(type)) capabilities.push('update_title', 'update_description');
    if (editable) capabilities.push('update_required');
    if (isChoiceType(type)) capabilities.push('update_options');
    // Deletion and retyping are never offered on Typeform (see the header), and a move is only safe
    // while nothing depends on the order.
    if (!hasLogic) capabilities.push('move');
    const choices = Array.isArray(field.properties?.choices)
      ? (field.properties!.choices as Array<{ label?: unknown }>).map(choice => String(choice?.label ?? ''))
      : undefined;
    const description = typeof field.properties?.description === 'string' ? field.properties.description : undefined;
    return {
      itemId: itemIdOf(field, index),
      questionId: itemIdOf(field, index),
      index,
      sectionIndex: 0,
      kind: 'question',
      title: typeof field.title === 'string' ? field.title : '',
      ...(description ? { description } : {}),
      questionType: mapTypeToEditor(type),
      required: field.validations?.required === true,
      ...(choices && choices.length > 0 ? { options: choices } : {}),
      hasRouting: hasLogic && (resource.logic ?? []).some(entry => entry.ref === itemIdOf(field, index)),
      capabilities,
    };
  });
  return {
    providerFormId: resource.id,
    revisionId: String(resource.updatedAt ?? ''),
    title: resource.title ?? '',
    ...(welcomeDescription(resource) ? { description: welcomeDescription(resource)! } : {}),
    editUrl,
    responderUrl,
    items,
    hasSections: false,
    hasBranching: hasLogic,
    isQuiz: false,
  };
}

function mapTypeToEditor(type: string): FormEditItem['questionType'] {
  if (type === 'multiple_choice' || type === 'dropdown') return type;
  if (type === 'picture_choice' || type === 'yes_no') return 'multiple_choice';
  if (type === 'number') return 'short_text';
  if (type === 'website') return 'short_text';
  if (type === 'opinion_scale' || type === 'rating') return 'rating';
  if (type === 'short_text' || type === 'long_text' || type === 'email' || type === 'date') return type;
  return 'unknown';
}

/**
 * True when the live form is still the one the proposal was prepared against. Compared field by
 * field because `updatedAt` alone can be identical across two very fast edits, and because a rename
 * in Typeform's UI updates the form without necessarily changing every field.
 */
export function typeformUnchanged(base: FormEditSnapshot, fresh: FormEditSnapshot): boolean {
  if (base.providerFormId !== fresh.providerFormId || base.revisionId !== fresh.revisionId || base.title !== fresh.title ||
      (base.description ?? '') !== (fresh.description ?? '') || base.items.length !== fresh.items.length ||
      base.hasBranching !== fresh.hasBranching) return false;
  return base.items.every((item, index) => {
    const other = fresh.items[index];
    return !!other && item.itemId === other.itemId && item.title === other.title &&
      (item.description ?? '') === (other.description ?? '') && item.questionType === other.questionType &&
      (item.required ?? false) === (other.required ?? false) &&
      JSON.stringify(item.options ?? []) === JSON.stringify(other.options ?? []);
  });
}

/** A conservative fingerprint: the things a concurrent editor could change that would matter. */
export function typeformFingerprint(resource: TypeformFormResource): string {
  return JSON.stringify({
    id: resource.id,
    updatedAt: resource.updatedAt,
    title: resource.title,
    fields: (resource.fields ?? []).map(field => ({
      id: field.id, ref: field.ref, title: field.title, type: field.type,
      required: field.validations?.required === true,
      choices: (field.properties?.choices as unknown) ?? null,
      description: field.properties?.description ?? null,
    })),
    logic: resource.logic ?? [],
    settings: resource.settings ?? null,
    welcome: resource.welcomeScreens ?? null,
    thankyou: resource.thankYouScreens ?? null,
  });
}

/**
 * Refuses an operation Typeform cannot do safely, before anything is built. The adapter calls this
 * with the live resource so the refusal reflects the form as it is now, not as it was proposed.
 */
export function refuseUnsafeTypeformOperation(resource: TypeformFormResource, plan: FormEditPlan): string | null {
  const byId = new Map<string, TypeformField>();
  (resource.fields ?? []).forEach((field, index) => byId.set(itemIdOf(field, index), field));
  const hasLogic = (resource.logic ?? []).length > 0;
  for (const operation of plan.operations) {
    // The wording is shared with the workspace and the public trust page, so a person reads the
    // same explanation before asking and after being refused.
    if (operation.type === 'delete_question') return editLimitText('typeform', 'delete')!;
    if (operation.type === 'update_question' && operation.changes.type !== undefined) return editLimitText('typeform', 'retype')!;
    if (operation.type === 'move_question' && hasLogic) return editLimitText('typeform', 'reorder')!;
    if ('questionId' in operation && !byId.has(operation.questionId)) {
      return 'That question no longer exists on the form. Nothing was changed; review the current Typeform and prepare a new proposal.';
    }
  }
  return null;
}

/** Builds the payload and the state it must produce. Pure: the caller supplies the live resource. */
export function compileTypeformEdit(resource: TypeformFormResource, plan: FormEditPlan): TypeformEditCompilation {
  const refusal = refuseUnsafeTypeformOperation(resource, plan);
  if (refusal) throw new Error(refusal);

  const fields: TypeformField[] = clone(resource.fields ?? []);
  const indexById = new Map<string, number>();
  fields.forEach((field, index) => indexById.set(itemIdOf(field, index), index));

  let title = resource.title ?? '';
  let description = welcomeDescription(resource);

  for (const operation of plan.operations) {
    if (operation.type === 'update_title') {
      title = operation.title;
      continue;
    }
    if (operation.type === 'update_description') {
      description = operation.description;
      continue;
    }
    if (operation.type === 'add_question') {
      const field = newField(operation.question);
      const position = operation.position ?? fields.length;
      if (position < 0 || position > fields.length) throw new Error('That position does not exist on the current form.');
      fields.splice(position, 0, field);
      continue;
    }
    if (operation.type === 'move_question') {
      const from = indexById.get(operation.questionId);
      if (from === undefined) throw new Error('That question no longer exists on the form.');
      const [moved] = fields.splice(from, 1);
      const to = operation.position > from ? operation.position - 1 : operation.position;
      if (to < 0 || to > fields.length) throw new Error('That position does not exist on the current form.');
      fields.splice(to, 0, moved);
      continue;
    }
    if (operation.type !== 'update_question') throw new Error('That change is not supported on Typeform.');
    const at = indexById.get(operation.questionId);
    if (at === undefined) throw new Error('That question no longer exists on the form.');
    const field = fields[at];
    const changes = operation.changes;
    if (changes.title !== undefined) field.title = changes.title;
    if (changes.description !== undefined) {
      const properties = { ...(field.properties ?? {}) };
      if (changes.description) properties.description = changes.description;
      else delete properties.description;
      field.properties = properties;
    }
    if (changes.required !== undefined) field.validations = { ...(field.validations ?? {}), required: changes.required };
    if (changes.options !== undefined) {
      if (!isChoiceType(String(field.type))) throw new Error('Only choice questions have an option list to change.');
      const existing = Array.isArray(field.properties?.choices) ? (field.properties!.choices as Array<Record<string, unknown>>) : [];
      field.properties = {
        ...(field.properties ?? {}),
        // Keep each surviving choice object (attachments, ids) and relabel it; append the rest.
        choices: changes.options.map((label: string, index: number) => (existing[index] ? { ...existing[index], label } : { label })),
      };
    }
  }

  const welcomeScreens = clone(resource.welcomeScreens ?? []);
  if (description !== welcomeDescription(resource) && welcomeScreens.length > 0) {
    welcomeScreens[0] = {
      ...welcomeScreens[0],
      properties: { ...welcomeScreens[0].properties, description: description ?? '' },
    };
  }

  const themeHref = resource.theme?.id ? `https://api.typeform.com/themes/${resource.theme.id}` : undefined;
  const payload: TypeformEditPayload = {
    title,
    fields,
    settings: clone(resource.settings ?? ({} as TypeformSettings)),
    ...(themeHref ? { theme: { href: themeHref } } : {}),
    welcome_screens: welcomeScreens,
    thankyou_screens: clone(resource.thankYouScreens ?? []),
    logic: clone(resource.logic ?? []),
  };

  return {
    payload,
    expected: typeformEditSnapshot({ ...resource, title, welcomeScreens, fields, updatedAt: resource.updatedAt }),
  };
}

function newField(question: NewEditQuestion): TypeformField {
  const type = CREATABLE[question.type];
  const field: TypeformField = {
    title: question.title,
    type,
    properties: {},
    validations: { required: question.required === true },
  };
  if (question.description) field.properties = { ...field.properties, description: question.description };
  if (isChoiceType(type)) {
    field.properties = {
      ...field.properties,
      choices: (question.options ?? []).map(label => ({ label })),
      ...(question.type === 'checkboxes' ? { allowMultiple: true } : {}),
      ...(type === 'dropdown' ? { dropdown: true } : {}),
    };
  }
  return field;
}

/** Field ids that must survive the write, in order, ignoring the fields the plan legitimately added. */
function survivingIds(resource: TypeformFormResource): string[] {
  return (resource.fields ?? []).map((field, index) => itemIdOf(field, index));
}

export type TypeformVerification =
  | { ok: true }
  | { ok: false; reason: 'missing_fields'; detail: string }
  | { ok: false; reason: 'changed_fields'; detail: string }
  | { ok: false; reason: 'value_mismatch'; detail: string };

/**
 * Compares the form Typeform returned after the `PUT` against what the plan promised.
 *
 * Two different failures matter and they are reported separately: a field that vanished (Typeform
 * deleted data) and a value that did not change (the write did not take). The first is serious enough
 * that the caller blocks the proposal instead of offering a retry.
 */
export function verifyTypeformEdit(before: TypeformFormResource, after: TypeformFormResource, expected: FormEditSnapshot, plan: FormEditPlan): TypeformVerification {
  const kept = survivingIds(before);
  const afterIds = survivingIds(after);
  for (const id of kept) {
    if (!afterIds.includes(id)) return { ok: false, reason: 'missing_fields', detail: `The question “${id}” is missing after the update.` };
  }
  const removed = (plan.operations.filter(operation => operation.type === 'add_question').length);
  if (afterIds.length !== kept.length + removed) {
    return { ok: false, reason: 'changed_fields', detail: `Typeform returned ${afterIds.length} questions; the proposal expected ${kept.length + removed}.` };
  }
  const actual = typeformEditSnapshot(after);
  if (actual.title !== expected.title) return { ok: false, reason: 'value_mismatch', detail: 'The form title did not change.' };
  for (const operation of plan.operations) {
    if (!('questionId' in operation)) continue;
    const want = expected.items.find(item => item.questionId === operation.questionId);
    const got = actual.items.find(item => item.questionId === operation.questionId);
    if (!want || !got) return { ok: false, reason: 'missing_fields', detail: `The question “${operation.questionId}” is missing after the update.` };
    if (want.title !== got.title) return { ok: false, reason: 'value_mismatch', detail: `The title of “${operation.questionId}” did not change.` };
    if (want.required !== got.required) return { ok: false, reason: 'value_mismatch', detail: `The required setting of “${operation.questionId}” did not change.` };
    if (JSON.stringify(want.options ?? []) !== JSON.stringify(got.options ?? [])) return { ok: false, reason: 'value_mismatch', detail: `The options of “${operation.questionId}” did not change.` };
    if ((want.description ?? '') !== (got.description ?? '')) return { ok: false, reason: 'value_mismatch', detail: `The description of “${operation.questionId}” did not change.` };
  }
  // Order is verified for moves, and only for moves: a plain PUT that merely reorders by accident
  // would otherwise pass unnoticed.
  if (plan.operations.some(operation => operation.type === 'move_question')) {
    const wanted = expected.items.map(item => item.questionId).join('|');
    const got = actual.items.map(item => item.questionId).join('|');
    if (wanted !== got) return { ok: false, reason: 'changed_fields', detail: 'The questions are not in the proposed order.' };
  }
  return { ok: true };
}

export const TYPEFORM_EDIT_NOTE = 'Typeform forms are edited by rewriting the whole form from a fresh read: Intake preserves logic, settings, screens and every untouched question, and refuses changes Typeform cannot make safely (deleting a question, changing its type, reordering a form with logic).';
