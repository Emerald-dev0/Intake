import type { FormWarning, ValidationIssue } from '../../../../src/lib/forms';
import type { FormSpecification, QuestionSpecification } from '../../specification';

/**
 * Turns a validated FormSpecification into Google Forms API requests.
 *
 * Google has no per-question show/hide. The only conditional behaviour the API offers is section
 * routing: a radio or dropdown option can send the respondent to another section or submit the form.
 * So a `visibility` rule is compiled into sections, and any layout that routing cannot express is
 * refused up front with an explanation instead of producing a form that behaves differently.
 *
 * Documented facts this relies on (Google Forms API v1, Discovery revision 20260922):
 * - a section starts at a pageBreakItem and runs until the next one;
 * - after a section the respondent goes to the next section unless a chosen option routes elsewhere;
 * - PageBreakItem has no fields, so a section cannot have its own "after this section" navigation;
 * - Option.goToSectionId names a section header by item id, and goToAction is NEXT_SECTION,
 *   RESTART_FORM or SUBMIT_FORM;
 * - batchUpdate validates sub-requests one at a time in order, so an option can only name a section
 *   header that already exists, and location.index must be valid at that moment.
 *
 * Building order. The first batch creates the complete final structure: every section break and every
 * question, in final order. A question whose routing names a section is created there without its
 * routing, because the section id does not exist yet. The second batch, only when needed, creates each
 * such question again with its routing at the same position and deletes the plain copy. It uses only
 * createItem and deleteItem, so nothing depends on how an update mask treats nested option fields, and
 * the form is never in a shape Google might refuse (a page break first, or an empty section).
 *
 * Everything here is pure: no network, no clock, no randomness.
 */

export type GoogleOption = {
  value: string;
  goToAction?: 'NEXT_SECTION' | 'SUBMIT_FORM';
  goToSectionId?: string;
};

export interface GoogleItem {
  itemId?: string;
  title?: string;
  description?: string;
  pageBreakItem?: Record<string, never>;
  questionItem?: {
    question: {
      questionId?: string;
      required?: boolean;
      textQuestion?: { paragraph: boolean };
      choiceQuestion?: { type: 'RADIO' | 'CHECKBOX' | 'DROP_DOWN'; options: GoogleOption[]; shuffle?: boolean };
    };
  };
}

export type GoogleRequest =
  | { updateFormInfo: { info: { title?: string; description?: string }; updateMask: string } }
  | { createItem: { item: GoogleItem; location: { index: number } } }
  | { updateItem: { item: GoogleItem; location: { index: number }; updateMask: string } }
  | { moveItem: { originalLocation: { index: number }; newLocation: { index: number } } }
  | { deleteItem: { location: { index: number } } };

export type RouteTarget = { type: 'next' } | { type: 'submit' } | { type: 'section'; key: string };

export interface PlannedRoute {
  value: string;
  target: RouteTarget;
}

export interface PlannedSection {
  kind: 'section';
  key: string;
}

export interface PlannedQuestion {
  kind: 'question';
  key: string;
  question: QuestionSpecification;
  /** Present on a question that controls a conditional group. One entry per option. */
  routes?: PlannedRoute[];
}

export type PlannedItem = PlannedSection | PlannedQuestion;

export interface GoogleFormPlan {
  title: string;
  description?: string;
  /** Every form item in final order, including the section breaks Google needs. */
  items: PlannedItem[];
  warnings: FormWarning[];
}

export type PlanResult = { ok: true; plan: GoogleFormPlan } | { ok: false; issues: ValidationIssue[] };

interface Run {
  start: number;
  end: number;
  key: string | null;
  condition: { question: string; equals: string } | null;
}

function label(question: QuestionSpecification): string {
  return `"${question.id}"`;
}

export function planGoogleForm(specification: FormSpecification): PlanResult {
  const questions = specification.questions;
  const indexById = new Map<string, number>();
  questions.forEach((question, index) => indexById.set(question.id, index));

  const sourceOf = (question: QuestionSpecification): number => {
    if (!question.visibility) return -1;
    const found = indexById.get(question.visibility.when.question);
    if (found === undefined) throw new Error('planGoogleForm requires a validated specification');
    return found;
  };

  // Consecutive questions with the same condition form one group; that group becomes one section.
  const runs: Run[] = [];
  questions.forEach((question, index) => {
    const condition = question.visibility?.when ?? null;
    const key = condition ? `${condition.question}\u0000${condition.equals}` : null;
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.end = index + 1;
    else runs.push({ start: index, end: index + 1, key, condition });
  });

  const issues: ValidationIssue[] = [];

  // Conditions cannot be chained: the controlling question must itself always be shown.
  questions.forEach((question, index) => {
    const source = sourceOf(question);
    if (source < 0) return;
    if (questions[source].visibility) {
      issues.push({
        code: 'google_nested_condition',
        path: `questions[${index}].visibility`,
        message: `${label(question)} depends on ${label(questions[source])}, which is itself conditional. Google Forms cannot chain conditions this way, so the question that controls other questions must always be shown.`,
        hint: `Remove the visibility rule from "${questions[source].id}", or make "${question.id}" depend on a question that is always shown.`,
      });
    }
  });

  // A conditional group must directly follow the always-shown questions that contain its controller.
  runs.forEach((run, position) => {
    if (!run.condition) return;
    const first = questions[run.start];
    const source = sourceOf(first);
    const previous = runs[position - 1];
    if (!previous) return;
    if (previous.condition) {
      issues.push({
        code: 'google_condition_placement',
        path: `questions[${run.start}].visibility`,
        message: `${label(first)} starts a conditional group right after another conditional group. Google Forms can only skip a section from the question that leads into it, so two conditional groups cannot sit back to back.`,
        hint: `Put the controlling question "${questions[source].id}" directly before this group, after the earlier group's questions, or give both groups the same condition.`,
      });
    } else if (source < previous.start || source >= previous.end) {
      issues.push({
        code: 'google_condition_placement',
        path: `questions[${run.start}].visibility`,
        message: `${label(first)} depends on "${questions[source].id}", but other questions sit between them. In Google Forms a conditional group must come directly after the always-shown questions that contain its controlling question.`,
        hint: `Move "${first.id}" (and any questions with the same condition) so they follow the group that contains "${questions[source].id}" without another conditional group in between.`,
      });
    }
  });

  // Skipping only works if an unanswered controlling question cannot slip through to the group.
  const checkedSources = new Set<number>();
  questions.forEach(question => {
    const source = sourceOf(question);
    if (source < 0 || checkedSources.has(source)) return;
    checkedSources.add(source);
    if (!questions[source].required) {
      issues.push({
        code: 'google_condition_source_not_required',
        path: `questions[${source}].required`,
        message: `"${questions[source].id}" controls which questions appear, so it must be required in Google Forms. If it were optional, a respondent who skipped it would still be sent to the conditional questions.`,
        hint: `Set "required": true on "${questions[source].id}".`,
      });
    }
  });

  if (issues.length > 0) return { ok: false, issues };

  const sectionKey = (position: number): string => `section_${position}`;
  const items: PlannedItem[] = [];
  const byQuestionId = new Map<string, PlannedQuestion>();
  runs.forEach((run, position) => {
    if (position > 0) items.push({ kind: 'section', key: sectionKey(position) });
    for (let index = run.start; index < run.end; index += 1) {
      const question = questions[index];
      const planned: PlannedQuestion = { kind: 'question', key: `question:${question.id}`, question };
      byQuestionId.set(question.id, planned);
      items.push(planned);
    }
  });

  // The controlling question routes: its trigger answer continues into the group, every other answer
  // skips it to the next always-shown section, or submits when the group is the end of the form.
  runs.forEach((run, position) => {
    if (!run.condition) return;
    const controller = byQuestionId.get(run.condition.question);
    const source = questions[indexById.get(run.condition.question) as number];
    if (!controller || !source.options) return;
    const join = runs[position + 1];
    controller.routes = source.options.map(value => ({
      value,
      target: value === run.condition!.equals ? { type: 'next' } : join ? { type: 'section', key: sectionKey(position + 1) } : { type: 'submit' },
    }));
  });

  const warnings: FormWarning[] = [];
  for (const question of questions) {
    if (question.type === 'email') {
      warnings.push({
        code: 'email_validation_unavailable',
        questionId: question.id,
        message: `"${question.title}" was created as a short-answer question. The Google Forms API cannot turn on email validation, so Google will not check the format. Add it in Google Forms if you need it.`,
      });
    }
  }

  return { ok: true, plan: { title: specification.title, ...(specification.description ? { description: specification.description } : {}), items, warnings } };
}

/** A routing question that points at a section can only be given that routing after the section exists. */
function isDeferred(item: PlannedItem): item is PlannedQuestion {
  return item.kind === 'question' && !!item.routes?.some(route => route.target.type === 'section');
}

export function hasDeferredRouting(plan: GoogleFormPlan): boolean {
  return plan.items.some(isDeferred);
}

/** `sectionIds` is null while section ids are not known yet: a deferred question is then built without routing. */
function buildItem(item: PlannedItem, sectionIds: ReadonlyMap<string, string> | null): GoogleItem {
  if (item.kind === 'section') return { pageBreakItem: {} };
  const { question } = item;
  const routes = sectionIds === null && isDeferred(item) ? undefined : item.routes;
  const google: GoogleItem = { title: question.title };
  if (question.description) google.description = question.description;
  const base = question.required ? { required: true } : {};
  if (question.type === 'short_text' || question.type === 'email') {
    google.questionItem = { question: { ...base, textQuestion: { paragraph: false } } };
  } else if (question.type === 'long_text') {
    google.questionItem = { question: { ...base, textQuestion: { paragraph: true } } };
  } else {
    const type = question.type === 'multiple_choice' ? 'RADIO' : question.type === 'dropdown' ? 'DROP_DOWN' : 'CHECKBOX';
    const options: GoogleOption[] = (question.options ?? []).map(value => {
      const route = routes?.find(candidate => candidate.value === value);
      if (!route) return { value };
      if (route.target.type === 'next') return { value, goToAction: 'NEXT_SECTION' };
      if (route.target.type === 'submit') return { value, goToAction: 'SUBMIT_FORM' };
      const sectionId = sectionIds?.get(route.target.key);
      if (!sectionId) throw new Error('A section id is required before its routing question can be created');
      return { value, goToSectionId: sectionId };
    });
    google.questionItem = { question: { ...base, choiceQuestion: { type, options } } };
  }
  return google;
}

/** The same conservative field mapping used by creation, for a new item in an existing form. */
export function buildGoogleQuestionItem(question: QuestionSpecification): GoogleItem {
  return buildItem({ kind: 'question', key: `question:${question.id}`, question }, null);
}

export interface InitialBatch {
  requests: GoogleRequest[];
  /** Parallel to requests: the plan key each request creates, or null for a request that creates nothing. */
  keys: (string | null)[];
}

/**
 * First batch: the description and the whole final structure. Indexes are consecutive from zero
 * because requests apply in order, and the first item is always a question.
 */
export function buildInitialBatch(plan: GoogleFormPlan): InitialBatch {
  const requests: GoogleRequest[] = [];
  const keys: (string | null)[] = [];
  if (plan.description) {
    requests.push({ updateFormInfo: { info: { description: plan.description }, updateMask: 'description' } });
    keys.push(null);
  }
  plan.items.forEach((item, index) => {
    requests.push({ createItem: { item: buildItem(item, null), location: { index } } });
    keys.push(item.key);
  });
  return { requests, keys };
}

/**
 * Second batch, only when a routing question points at a section. For each such question, in
 * ascending order: create the routed version at its final position, which pushes the plain copy one
 * place down, then delete the plain copy. Each pair leaves every later position where it was.
 */
export function buildRoutingBatch(plan: GoogleFormPlan, sectionIds: ReadonlyMap<string, string>): GoogleRequest[] {
  const requests: GoogleRequest[] = [];
  plan.items.forEach((item, finalIndex) => {
    if (!isDeferred(item)) return;
    requests.push({ createItem: { item: buildItem(item, sectionIds), location: { index: finalIndex } } });
    requests.push({ deleteItem: { location: { index: finalIndex + 1 } } });
  });
  return requests;
}

export function countQuestions(plan: GoogleFormPlan): number {
  return plan.items.filter(item => item.kind === 'question').length;
}
