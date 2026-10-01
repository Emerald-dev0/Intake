import { safeFormUrl, type FormOutcome, type FormStage, type PartialForm } from '../../../../src/lib/forms';
import { hasScope, logSafe } from '../../../providers/oauth';
import { getProviderConnection, reportProviderAuthorizationRejected, type AuthorizedConnection } from '../../../providers/service';
import { FormEngineError, type FormErrorInfo } from '../../errors';
import { createFormLogger, newRequestId, type FormLogger } from '../../logging';
import type { CreatedForm, FormsProvider } from '../../provider';
import type { FormSpecification, QuestionSpecification, QuestionType } from '../../specification';
import { ensureValidatedSpecification } from '../../validation';
import { FormEditError } from '../../edit-errors';
import { validateFormEditPlan, type ExpectedFormState } from '../../edit-validation';
import type { FormEditOperation, FormEditPlan, FormEditSnapshot, EditCapability, EditQuestionType } from '../../../../src/lib/form-edit';
import { createGoogleFormsClient, createdItemId, isFormId, GoogleFormsApiError, type GoogleFormsClient, type GoogleFormsOperation, type GoogleFormResource } from './client';
import { buildGoogleQuestionItem, buildInitialBatch, buildRoutingBatch, countQuestions, hasDeferredRouting, planGoogleForm, type GoogleItem, type GoogleRequest } from './plan';

/** Must stay equal to the required scope in server/providers/registry.ts; a test checks it. */
export const FORMS_BODY_SCOPE = 'https://www.googleapis.com/auth/forms.body';

export interface GoogleFormsProviderDeps {
  /** The existing provider connection service. Refreshes an expired access token itself. */
  getConnection?: (userId: string, provider: string) => Promise<AuthorizedConnection>;
  /** Called when Google rejects a token that Intake believed was valid, so the connection is marked for renewal. */
  reportAuthorizationRejected?: (userId: string, provider: string) => Promise<void>;
  client?: GoogleFormsClient;
}

type ConnectedGoogle = Extract<AuthorizedConnection, { ok: true }>;
type BuildStage = Exclude<FormStage, 'connection'>;

const STAGE_FAILED: Record<BuildStage, string> = {
  create: 'Google could not create the form.',
  add_questions: 'Google created an empty form but did not accept the questions.',
  configure_logic: 'The questions were added, but Google did not accept the conditional logic.',
  publish: 'The form was built, but Google did not publish it.',
};

export function createGoogleFormsProvider(deps: GoogleFormsProviderDeps = {}): FormsProvider {
  const getConnection = deps.getConnection ?? getProviderConnection;
  const reportRejected = deps.reportAuthorizationRejected ?? reportProviderAuthorizationRejected;
  const client = deps.client ?? createGoogleFormsClient();
  const fallbackLog = createFormLogger();

  return {
    id: 'google',
    capabilities: { createForm: true, editForm: true },

    async retrieveForm(userId, providerFormId, context) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;
      if (!isGoogleFormId(providerFormId)) throw new FormEditError({ code: 'invalid_form_url', message: 'That Google Forms URL does not contain a valid form ID.', outcome: 'not_applied', retryable: false });
      const connection = await acquireEditConnection(getConnection, userId);
      try {
        log('form.edit.provider_request', { requestId, userId, provider: 'google', operation: 'forms.get', formId: providerFormId, stage: 'retrieve' });
        const resource = await client.getForm(connection.accessToken, providerFormId);
        return { current: googleFormSnapshot(resource), externalAccountId: connection.externalAccountId };
      } catch (error) {
        throw await editReadFailure(error, { requestId, log, userId, formId: providerFormId, reportRejected });
      }
    },

    async applyEditPlan(userId, input, context) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;
      if (!isGoogleFormId(input.base.providerFormId) || input.plan.formId !== input.base.providerFormId) {
        throw new FormEditError({ code: 'edit_plan_invalid', message: 'The plan does not target the selected Google Form. Nothing was changed.', outcome: 'not_applied', retryable: false });
      }
      const connection = await acquireEditConnection(getConnection, userId);
      if (connection.externalAccountId !== input.expectedAccountId) {
        throw new FormEditError({ code: 'form_not_editable', message: 'The connected Google account changed after this proposal was prepared. Reconnect the original account and review the form again.', outcome: 'not_applied', retryable: false });
      }
      let freshResource: GoogleFormResource;
      try {
        log('form.edit.provider_request', { requestId, userId, provider: 'google', operation: 'forms.get', formId: input.base.providerFormId, stage: 'verify_before_apply' });
        freshResource = await client.getForm(connection.accessToken, input.base.providerFormId);
      } catch (error) {
        throw await editReadFailure(error, { requestId, log, userId, formId: input.base.providerFormId, reportRejected });
      }
      const fresh = googleFormSnapshot(freshResource);
      if (fresh.providerFormId !== input.base.providerFormId || fresh.revisionId !== input.base.revisionId || !sameTargets(input.base, fresh, input.plan)) {
        throw new FormEditError({ code: 'edit_stale', message: 'This Google Form changed after Intake prepared the proposal. Nothing was applied. Refresh the current form and review a new proposal.', outcome: 'stale', retryable: false });
      }
      const validation = validateFormEditPlan(fresh, { summary: input.plan.summary, operations: input.plan.operations });
      if (!validation.ok) {
        throw new FormEditError({ code: validation.kind === 'unsupported' ? 'edit_unsupported' : 'edit_plan_invalid',
          message: validation.issues.slice(0, 4).map(issue => issue.message).join(' ') || 'This proposal no longer passes validation. Nothing was changed.',
          outcome: 'not_applied', retryable: false, issues: validation.issues });
      }
      const requests = compileEditRequests(fresh, input.plan.operations);
      if (!requests.length) throw new FormEditError({ code: 'edit_plan_invalid', message: 'The plan did not contain an applicable change. Nothing was changed.', outcome: 'not_applied', retryable: false });
      try {
        log('form.edit.provider_request', { requestId, userId, provider: 'google', operation: 'forms.batchUpdate', formId: fresh.providerFormId, stage: 'apply', requestCount: requests.length });
        await client.batchUpdate(connection.accessToken, fresh.providerFormId, requests, { requiredRevisionId: fresh.revisionId });
      } catch (error) {
        const reconciliation = await reconcileAfterEditFailure(client, connection.accessToken, fresh, validation.expected, input.plan, error);
        if (reconciliation.kind === 'applied') return { current: reconciliation.current, externalAccountId: connection.externalAccountId };
        throw await editWriteFailure(error, { requestId, log, userId, formId: fresh.providerFormId, reportRejected, reconciliation });
      }
      let updated: FormEditSnapshot | null = null;
      let verificationError: unknown;
      // A fresh GET is safe to repeat once. This recovers a transient read failure after Google has
      // accepted the batch without ever resending potentially non-idempotent createItem requests.
      for (let attempt = 1; attempt <= 2 && !updated; attempt += 1) {
        try {
          log('form.edit.provider_request', { requestId, userId, provider: 'google', operation: 'forms.get', formId: fresh.providerFormId, stage: 'verify_after_apply', attempt });
          updated = googleFormSnapshot(await client.getForm(connection.accessToken, fresh.providerFormId));
        } catch (error) {
          verificationError = error;
          const api = error instanceof GoogleFormsApiError ? error.info : null;
          log('form.edit.provider_failed', { requestId, userId, provider: 'google', operation: 'forms.get', formId: fresh.providerFormId,
            stage: 'verify_after_apply', attempt, kind: api?.kind ?? 'unexpected', httpStatus: api?.httpStatus, googleStatus: api?.googleStatus, outcome: 'unknown' });
        }
      }
      if (!updated) {
        const api = verificationError instanceof GoogleFormsApiError ? verificationError.info : null;
        if (api?.kind === 'http' && api.httpStatus === 401) {
          try { await reportRejected?.(userId, 'google'); } catch (reportError) { logSafe('Could not mark the Google connection for renewal', reportError); }
        }
        throw new FormEditError({ code: 'provider_unavailable', message: 'Google accepted the update request, but Intake could not verify the resulting form after a safe read retry. Do not submit this proposal again; check the original Google Form before starting a new edit.', outcome: 'unknown', retryable: false });
      }
      if (!matchesExpected(updated, validation.expected, input.plan)) {
        const outcome = hasAnyPlannedEffect(fresh, updated, input.plan) ? 'partial' : 'unknown';
        log('form.edit.provider_failed', { requestId, userId, provider: 'google', operation: 'forms.batchUpdate', formId: fresh.providerFormId, stage: 'verify_after_apply', outcome });
        throw new FormEditError({ code: outcome === 'partial' ? 'provider_error' : 'provider_unavailable',
          message: outcome === 'partial' ? 'Google applied only part of the proposal. Intake verified the current form and will not retry automatically. Review the original form, then prepare a new edit for any remaining changes.' : 'Google returned a successful update, but Intake could not verify that all proposed changes are present. Do not retry this proposal; inspect the original form first.', outcome, retryable: false });
      }
      log('form.edit.completed', { requestId, userId, provider: 'google', formId: updated.providerFormId, operationCount: input.plan.operations.length, questionCount: updated.items.filter(item => item.kind === 'question').length });
      return { current: updated, externalAccountId: connection.externalAccountId };
    },

    async createForm(userId, specification, context) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;

      // 1. Nothing below runs, and no request of any kind is made, unless the specification is valid
      //    and Google can express it.
      const spec: FormSpecification = ensureValidatedSpecification(specification);
      const planned = planGoogleForm(spec);
      if (!planned.ok) {
        throw new FormEngineError({
          code: 'unsupported_by_provider',
          message: 'Google Forms cannot express this form as written. Nothing was created.',
          issues: planned.issues,
          provider: 'google',
          outcome: 'not_created',
          retryable: false,
        });
      }
      const plan = planned.plan;

      // 2. The user's own connection, refreshed if needed, by the existing provider service.
      const connection = await acquireConnection(getConnection, userId);
      const token = connection.accessToken;

      let stage: BuildStage = 'create';
      let formId: string | null = null;
      let operation: GoogleFormsOperation = 'forms.create';
      try {
        request(log, requestId, 'forms.create', stage, null, { questionCount: countQuestions(plan) });
        const created = await client.createForm(token, { title: plan.title, documentTitle: plan.title, unpublished: true });
        formId = created.formId;

        stage = 'add_questions';
        operation = 'forms.batchUpdate';
        const initial = buildInitialBatch(plan);
        request(log, requestId, operation, stage, formId, { requestCount: initial.requests.length });
        const first = await client.batchUpdate(token, formId, initial.requests);

        if (hasDeferredRouting(plan)) {
          // Google accepted the structure. From here a failure is about the conditional logic only.
          stage = 'configure_logic';
          const sectionIds = new Map<string, string>();
          initial.keys.forEach((key, position) => {
            if (!key || !key.startsWith('section_')) return;
            const id = createdItemId(first.replies[position]);
            if (!id) throw new GoogleFormsApiError({ operation: 'forms.batchUpdate', kind: 'malformed_response' });
            sectionIds.set(key, id);
          });
          const routing = buildRoutingBatch(plan, sectionIds);
          request(log, requestId, operation, stage, formId, { requestCount: routing.length });
          await client.batchUpdate(token, formId, routing);
        }

        stage = 'publish';
        operation = 'forms.setPublishSettings';
        request(log, requestId, operation, stage, formId, {});
        const state = await client.setPublishSettings(token, formId, { isPublished: true, isAcceptingResponses: true });
        if (state.isPublished === false || state.isAcceptingResponses === false) {
          throw new GoogleFormsApiError({ operation: 'forms.setPublishSettings', kind: 'malformed_response' });
        }

        const result: CreatedForm = {
          provider: 'google',
          providerFormId: formId,
          title: plan.title,
          editUrl: editUrl(formId),
          published: true,
          warnings: plan.warnings,
          externalAccountId: connection.externalAccountId,
        };
        const responder = safeFormUrl(created.responderUri);
        if (responder) result.responderUrl = responder;
        return result;
      } catch (error) {
        throw await failure(error, { stage, operation, formId, requestId, log, userId, connection, reportRejected });
      }
    },
  };
}

type EditReconciliation = { kind: 'applied'; current: FormEditSnapshot } | { kind: 'unchanged' | 'partial' | 'unknown'; current?: FormEditSnapshot };

function isGoogleFormId(value: unknown): value is string {
  return isFormId(value);
}

async function acquireEditConnection(getConnection: NonNullable<GoogleFormsProviderDeps['getConnection']>, userId: string): Promise<ConnectedGoogle> {
  try {
    return await acquireConnection(getConnection, userId, 'edit');
  } catch (error) {
    if (error instanceof FormEngineError) {
      throw new FormEditError({ code: error.info.code as FormEditError['info']['code'], message: error.info.message,
        outcome: 'not_applied', retryable: error.info.retryable });
    }
    throw new FormEditError({ code: 'storage_unavailable', message: 'Intake could not verify your Google connection. The form was not changed.', outcome: 'not_applied', retryable: true });
  }
}

function googleFormSnapshot(resource: GoogleFormResource): FormEditSnapshot {
  const sectionIds = new Set(resource.items.filter(item => item.kind === 'section').map(item => item.itemId));
  let hasBranching = false;
  let sectionIndex = 0;
  const items = resource.items.map((item, index) => {
    if (item.kind === 'section') sectionIndex += 1;
    const options = item.options ?? [];
    const hasRouting = options.some(option => option.hasRouting);
    if (hasRouting) hasBranching = true;
    for (const option of options) {
      if (option.goToAction && !['NEXT_SECTION', 'RESTART_FORM', 'SUBMIT_FORM'].includes(option.goToAction)) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
      if (option.goToSectionId && !sectionIds.has(option.goToSectionId)) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
      if (option.hasRouting && item.questionType === 'checkboxes') throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
    }
    const capabilities: EditCapability[] = [];
    if (item.kind === 'question' && item.questionId) {
      const known = ['short_text', 'long_text', 'multiple_choice', 'dropdown', 'checkboxes'].includes(item.questionType ?? '');
      if (known) capabilities.push('update_title', 'update_description', 'update_required');
      const special = options.some(option => option.hasImage || option.isOther || option.hasRouting);
      const simple = known && !special && !item.hasGrading && !resource.isQuiz;
      if (simple) capabilities.push('update_type');
      if (simple && ['multiple_choice', 'dropdown', 'checkboxes'].includes(item.questionType ?? '')) capabilities.push('update_options');
      if (!hasRouting && !resource.isQuiz && !item.hasGrading) capabilities.push('delete', 'move');
    }
    const mappedType = item.questionType ?? (item.kind === 'question' ? 'unknown' : undefined);
    return {
      itemId: item.itemId, ...(item.questionId ? { questionId: item.questionId } : {}), index, sectionIndex,
      kind: item.kind, title: item.title, ...(item.description !== undefined ? { description: item.description } : {}),
      ...(mappedType ? { questionType: mappedType as EditQuestionType } : {}),
      ...(item.kind === 'question' ? { required: item.required ?? false, options: options.map(option => option.value), hasRouting } : {}),
      capabilities,
    };
  });
  return { providerFormId: resource.formId, revisionId: resource.revisionId, title: resource.info.title,
    ...(resource.info.description !== undefined ? { description: resource.info.description } : {}), editUrl: editUrl(resource.formId),
    responderUrl: safeFormUrl(resource.responderUri), items, hasSections: sectionIds.size > 0, hasBranching, isQuiz: resource.isQuiz };
}

function sameTargets(base: FormEditSnapshot, fresh: FormEditSnapshot, plan: FormEditPlan): boolean {
  if (base.providerFormId !== fresh.providerFormId || base.revisionId !== fresh.revisionId || base.title !== fresh.title ||
      (base.description ?? '') !== (fresh.description ?? '') || base.items.length !== fresh.items.length) return false;
  for (const operation of plan.operations) {
    if (!('questionId' in operation)) continue;
    const before = base.items.find(item => item.questionId === operation.questionId);
    const after = fresh.items.find(item => item.questionId === operation.questionId);
    if (!before || !after || before.itemId !== after.itemId || before.index !== after.index || before.title !== after.title ||
        (before.description ?? '') !== (after.description ?? '') || before.questionType !== after.questionType || before.required !== after.required ||
        JSON.stringify(before.options ?? []) !== JSON.stringify(after.options ?? []) || before.hasRouting !== after.hasRouting) return false;
  }
  return true;
}

function googleChoiceType(type: QuestionType): 'RADIO' | 'CHECKBOX' | 'DROP_DOWN' {
  return type === 'multiple_choice' ? 'RADIO' : type === 'dropdown' ? 'DROP_DOWN' : 'CHECKBOX';
}
function questionTypeFromSnapshot(item: FormEditSnapshot['items'][number]): QuestionType {
  return ['short_text', 'long_text', 'multiple_choice', 'dropdown', 'checkboxes'].includes(item.questionType ?? '') ? item.questionType as QuestionType : 'short_text';
}
function questionSpecFromItem(item: FormEditSnapshot['items'][number], changes: { title?: string; description?: string; type?: QuestionType; required?: boolean; options?: string[] }): QuestionSpecification {
  const type = changes.type ?? questionTypeFromSnapshot(item);
  return { id: 'existing_question', title: changes.title ?? (item.title || 'Question'),
    ...(changes.description !== undefined ? (changes.description ? { description: changes.description } : {}) : (item.description ? { description: item.description } : {})),
    type, required: changes.required ?? item.required ?? false,
    ...(type === 'multiple_choice' || type === 'dropdown' || type === 'checkboxes' ? { options: changes.options ?? item.options ?? [] } : {}) };
}

function compileEditRequests(current: FormEditSnapshot, operations: FormEditOperation[]): GoogleRequest[] {
  const requests: GoogleRequest[] = [];
  const live = current.items.map(item => ({ itemId: item.itemId, ...(item.questionId ? { questionId: item.questionId } : {}), kind: item.kind }));
  for (const [operationIndex, operation] of operations.entries()) {
    if (operation.type === 'update_title') requests.push({ updateFormInfo: { info: { title: operation.title }, updateMask: 'title' } });
    else if (operation.type === 'update_description') requests.push({ updateFormInfo: { info: { description: operation.description }, updateMask: 'description' } });
    else if (operation.type === 'add_question') {
      const position = operation.position ?? live.length;
      const spec: QuestionSpecification = { id: `added_${operationIndex + 1}`, ...operation.question, required: operation.question.required ?? false };
      requests.push({ createItem: { item: buildGoogleQuestionItem(spec), location: { index: position } } });
      live.splice(position, 0, { itemId: `new:${operationIndex}`, kind: 'question' });
    } else if (operation.type === 'delete_question') {
      const index = live.findIndex(item => item.questionId === operation.questionId);
      if (index < 0) throw new Error('Validated edit target disappeared while compiling');
      requests.push({ deleteItem: { location: { index } } });
      live.splice(index, 1);
    } else if (operation.type === 'move_question') {
      const original = live.findIndex(item => item.questionId === operation.questionId);
      if (original < 0) throw new Error('Validated edit target disappeared while compiling');
      const [item] = live.splice(original, 1);
      requests.push({ moveItem: { originalLocation: { index: original }, newLocation: { index: operation.position } } });
      live.splice(operation.position, 0, item);
    } else {
      const target = current.items.find(item => item.questionId === operation.questionId);
      const index = live.findIndex(item => item.questionId === operation.questionId);
      if (!target || index < 0 || !target.itemId || !target.questionId) throw new Error('Validated edit target disappeared while compiling');
      const body: GoogleItem = { itemId: target.itemId };
      const mask: string[] = [];
      const changes = operation.changes;
      if (changes.title !== undefined) { body.title = changes.title; mask.push('title'); }
      if (changes.description !== undefined) { body.description = changes.description; mask.push('description'); }
      const crossKind = changes.type !== undefined &&
        (['short_text', 'long_text'].includes(questionTypeFromSnapshot(target)) !== ['short_text', 'long_text'].includes(changes.type));
      if (crossKind) {
        const complete = buildGoogleQuestionItem(questionSpecFromItem(target, changes));
        if (!complete.questionItem) throw new Error('A supported Google question item could not be built');
        complete.itemId = target.itemId;
        complete.questionItem.question.questionId = target.questionId;
        body.questionItem = complete.questionItem;
        mask.push('questionItem.question');
      } else {
        if (changes.required !== undefined) {
          body.questionItem = { question: { questionId: target.questionId, required: changes.required } };
          mask.push('questionItem.question.required');
        }
        if (changes.type !== undefined) {
          body.questionItem ??= { question: { questionId: target.questionId } };
          if (['short_text', 'long_text'].includes(changes.type)) {
            body.questionItem.question.textQuestion = { paragraph: changes.type === 'long_text' };
            mask.push('questionItem.question.textQuestion.paragraph');
          } else {
            body.questionItem.question.choiceQuestion = { type: googleChoiceType(changes.type), options: (changes.options ?? target.options ?? []).map(value => ({ value })) };
            mask.push('questionItem.question.choiceQuestion.type');
            if (changes.options !== undefined) mask.push('questionItem.question.choiceQuestion.options');
          }
        } else if (changes.options !== undefined) {
          body.questionItem = { question: { questionId: target.questionId,
            choiceQuestion: { type: googleChoiceType(questionTypeFromSnapshot(target)), options: changes.options.map(value => ({ value })) } } };
          mask.push('questionItem.question.choiceQuestion.options');
        }
      }
      if (mask.length) requests.push({ updateItem: { item: body, location: { index }, updateMask: [...new Set(mask)].join(',') } });
    }
  }
  return requests;
}

function expectedTypeWasChanged(plan: FormEditPlan, questionId: string): boolean {
  return plan.operations.some(operation => operation.type === 'update_question' && operation.questionId === questionId && operation.changes.type !== undefined);
}
function itemMatchesExpected(actual: FormEditSnapshot['items'][number], expected: ExpectedFormState['items'][number], plan: FormEditPlan): boolean {
  const old = expected.existingItem;
  if (old) {
    if (actual.itemId !== old.itemId || actual.kind !== old.kind || actual.title !== (expected.question?.title ?? old.title) ||
        (actual.description ?? '') !== (expected.question?.description ?? old.description ?? '')) return false;
    if (old.questionId) {
      const typeChanged = expectedTypeWasChanged(plan, old.questionId);
      const desiredType = typeChanged ? expected.question?.type : old.questionType;
      const desiredRequired = expected.question?.required ?? old.required;
      const desiredOptions = typeChanged || plan.operations.some(operation => operation.type === 'update_question' && operation.questionId === old.questionId && operation.changes.options !== undefined)
        ? expected.question?.options ?? [] : old.options ?? [];
      if (actual.questionId !== old.questionId || actual.questionType !== desiredType || actual.required !== desiredRequired ||
          JSON.stringify(actual.options ?? []) !== JSON.stringify(desiredOptions)) return false;
    }
    return true;
  }
  const question = expected.question;
  return !!question && actual.kind === 'question' && actual.title === question.title && (actual.description ?? '') === (question.description ?? '') &&
    actual.questionType === question.type && actual.required === (question.required ?? false) && JSON.stringify(actual.options ?? []) === JSON.stringify(question.options ?? []);
}
function matchesExpected(current: FormEditSnapshot, expected: ExpectedFormState, plan: FormEditPlan): boolean {
  if (current.title !== expected.title || (current.description ?? '') !== expected.description || current.items.length !== expected.items.length) return false;
  return expected.items.every((item, index) => itemMatchesExpected(current.items[index], item, plan));
}
function hasAnyPlannedEffect(base: FormEditSnapshot, actual: FormEditSnapshot, plan: FormEditPlan): boolean {
  for (const operation of plan.operations) {
    if (operation.type === 'update_title' && actual.title === operation.title) return true;
    if (operation.type === 'update_description' && (actual.description ?? '') === operation.description) return true;
    if (operation.type === 'add_question') {
      const before = base.items.filter(item => item.kind === 'question' && item.title === operation.question.title).length;
      const after = actual.items.filter(item => item.kind === 'question' && item.title === operation.question.title).length;
      if (after > before) return true;
    }
    if (operation.type === 'delete_question' && !actual.items.some(item => item.questionId === operation.questionId)) return true;
    if (operation.type === 'move_question') {
      const before = base.items.find(item => item.questionId === operation.questionId);
      const after = actual.items.find(item => item.questionId === operation.questionId);
      if (before && after && before.index !== after.index) return true;
    }
    if (operation.type === 'update_question') {
      const after = actual.items.find(item => item.questionId === operation.questionId);
      if (after && Object.entries(operation.changes).some(([key, value]) => {
        if (key === 'description') return (after.description ?? '') === value;
        if (key === 'options') return JSON.stringify(after.options ?? []) === JSON.stringify(value);
        if (key === 'type') return after.questionType === value;
        return (after as unknown as Record<string, unknown>)[key] === value;
      })) return true;
    }
  }
  return false;
}

async function reconcileAfterEditFailure(client: GoogleFormsClient, token: string, base: FormEditSnapshot, expected: ExpectedFormState, plan: FormEditPlan, _error: unknown): Promise<EditReconciliation> {
  try {
    const latest = googleFormSnapshot(await client.getForm(token, base.providerFormId));
    if (matchesExpected(latest, expected, plan)) return { kind: 'applied', current: latest };
    if (hasAnyPlannedEffect(base, latest, plan)) return { kind: 'partial', current: latest };
    if (latest.revisionId === base.revisionId) return { kind: 'unchanged', current: latest };
    return { kind: 'unknown', current: latest };
  } catch { return { kind: 'unknown' }; }
}

async function editReadFailure(error: unknown, context: { requestId: string; log: FormLogger; userId: string; formId: string; reportRejected: GoogleFormsProviderDeps['reportAuthorizationRejected'] }): Promise<FormEditError> {
  if (error instanceof FormEditError) return error;
  const api = error instanceof GoogleFormsApiError ? error.info : null;
  if (!api) {
    logSafe('Google form retrieval failed unexpectedly', error);
    return new FormEditError({ code: 'internal_error', message: 'Intake could not read this Google Form. The form was not changed.', outcome: 'not_applied', retryable: false });
  }
  if (api.kind === 'http' && api.httpStatus === 401) {
    try { await context.reportRejected?.(context.userId, 'google'); } catch (reportError) { logSafe('Could not mark the Google connection for renewal', reportError); }
  }
  context.log('form.edit.provider_failed', { requestId: context.requestId, userId: context.userId, provider: 'google', operation: api.operation,
    stage: 'retrieve', formId: context.formId, kind: api.kind, httpStatus: api.httpStatus, googleStatus: api.googleStatus, reason: api.reason });
  return mapGoogleEditFailure(api, 'not_applied');
}

async function editWriteFailure(error: unknown, context: { requestId: string; log: FormLogger; userId: string; formId: string; reportRejected: GoogleFormsProviderDeps['reportAuthorizationRejected']; reconciliation: EditReconciliation }): Promise<FormEditError> {
  if (context.reconciliation.kind === 'partial') {
    context.log('form.edit.provider_failed', { requestId: context.requestId, userId: context.userId, provider: 'google', operation: 'forms.batchUpdate', stage: 'apply', formId: context.formId, outcome: 'partial' });
    return new FormEditError({ code: 'provider_error', message: 'Google applied only part of the proposal. Intake verified the current form and will not retry automatically. Review the original form, then prepare a new edit for any remaining changes.', outcome: 'partial', retryable: false,
      ...(context.reconciliation.current ? { current: context.reconciliation.current } : {}) });
  }
  const api = error instanceof GoogleFormsApiError ? error.info : null;
  if (!api) {
    logSafe('Google form edit failed unexpectedly', error);
    return new FormEditError({ code: 'internal_error', message: 'Intake could not confirm whether the edit was applied. Do not retry this proposal. Check the original Google Form first.', outcome: 'unknown', retryable: false,
      ...(context.reconciliation.current ? { current: context.reconciliation.current } : {}) });
  }
  if (api.kind === 'http' && api.httpStatus === 401) {
    try { await context.reportRejected?.(context.userId, 'google'); } catch (reportError) { logSafe('Could not mark the Google connection for renewal', reportError); }
  }
  let result: FormEditError;
  if (context.reconciliation.kind === 'unknown' || api.kind === 'timeout' || api.kind === 'network' || api.kind === 'malformed_response' || (api.kind === 'http' && (api.httpStatus ?? 0) >= 500)) {
    result = new FormEditError({ code: 'provider_unavailable', message: 'Google did not confirm whether all proposed changes were applied. Do not retry this proposal. Check the original form before starting a new edit.', outcome: 'unknown', retryable: false });
  } else result = mapGoogleEditFailure(api, 'not_applied');
  if (context.reconciliation.current) result = new FormEditError({ ...result.info, current: context.reconciliation.current });
  context.log('form.edit.provider_failed', { requestId: context.requestId, userId: context.userId, provider: 'google', operation: api.operation,
    stage: 'apply', formId: context.formId, kind: api.kind, httpStatus: api.httpStatus, googleStatus: api.googleStatus, reason: api.reason,
    outcome: result.info.outcome, code: result.info.code });
  return result;
}

function mapGoogleEditFailure(api: GoogleFormsApiError['info'], outcome: FormEditError['info']['outcome']): FormEditError {
  if (api.kind === 'timeout' || api.kind === 'network') return new FormEditError({ code: 'provider_unavailable', message: 'Google Forms could not be reached. The form was not changed.', outcome, retryable: outcome === 'not_applied' });
  if (api.kind === 'malformed_response') return new FormEditError({ code: 'provider_error', message: 'Google returned a response Intake could not safely use. The form was not changed.', outcome, retryable: false });
  const status = api.httpStatus ?? 0;
  if (status === 401) return new FormEditError({ code: 'provider_reauthorization_required', message: 'Google no longer accepts Intake’s authorization. Reconnect Google, then review the form again.', outcome, retryable: false });
  if (status === 403) {
    if (api.reason === 'SERVICE_DISABLED' || api.reason === 'API_DISABLED') return new FormEditError({ code: 'provider_permission_denied', message: 'The Google Forms API is not enabled for the Google Cloud project Intake uses.', outcome, retryable: false });
    if (api.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') return new FormEditError({ code: 'provider_reauthorization_required', message: 'Google did not grant Intake the requested Forms permission. Reconnect Google and allow the existing Forms access.', outcome, retryable: false });
    return new FormEditError({ code: 'form_not_editable', message: 'This Google account can read the form but Google did not authorize an edit. Use an account with editor access, then load the form again.', outcome, retryable: false });
  }
  if (status === 404) return new FormEditError({ code: 'form_not_found', message: 'Google Forms could not find this form for the connected account. Check the edit URL and Google account.', outcome, retryable: false });
  if (status === 429) return new FormEditError({ code: 'provider_rate_limited', message: 'Google is limiting form requests. Wait a moment and try again.', outcome, retryable: outcome === 'not_applied',
    ...(outcome === 'not_applied' && api.retryAfterSeconds ? { retryAfterSeconds: api.retryAfterSeconds } : {}) });
  if (status >= 500) return new FormEditError({ code: 'provider_unavailable', message: 'Google Forms is temporarily unavailable.', outcome, retryable: false });
  return new FormEditError({ code: 'provider_rejected', message: 'Google rejected the requested form edit. Intake made no replacement form and will not retry it automatically.', outcome, retryable: false, detail: api.detail });
}

function request(log: FormLogger, requestId: string, operation: GoogleFormsOperation, stage: BuildStage, formId: string | null, extra: Record<string, number>): void {
  log('form.create.provider_request', { requestId, provider: 'google', operation, stage, formId, ...extra });
}

export function editUrl(formId: string): string {
  return `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/edit`;
}

async function acquireConnection(getConnection: NonNullable<GoogleFormsProviderDeps['getConnection']>, userId: string, action: 'create' | 'edit' = 'create'): Promise<ConnectedGoogle> {
  let result: AuthorizedConnection;
  try {
    result = await getConnection(userId, 'google');
  } catch (error) {
    logSafe('Forms connection lookup failed', error);
    throw new FormEngineError({
      code: 'storage_unavailable',
      message: action === 'create' ? 'Intake could not read your Google connection right now. Nothing was created. Try again in a moment.' : 'Intake could not read your Google connection. The form was not changed. Try again in a moment.',
      provider: 'google',
      stage: 'connection',
      outcome: 'not_created',
      retryable: true,
    });
  }
  if (!result.ok) throw connectionError(result.reason, action);
  // The service already scopes by user. This is a second, independent check of the ownership chain.
  if (result.provider !== 'google' || result.userId !== userId) {
    logSafe('Forms connection ownership mismatch');
    throw new FormEngineError({ code: 'internal_error', message: action === 'create' ? 'Intake could not verify which Google connection to use. Nothing was created.' : 'Intake could not verify the Google connection. The form was not changed.', provider: 'google', stage: 'connection', outcome: 'not_created', retryable: false });
  }
  if (!hasScope(result.scopes, FORMS_BODY_SCOPE)) {
    throw connectionError('reauthorization_required', action);
  }
  return result;
}

type ConnectionFailure = Extract<AuthorizedConnection, { ok: false }>['reason'];

function connectionError(reason: ConnectionFailure, action: 'create' | 'edit' = 'create'): FormEngineError {
  const base = { provider: 'google' as const, stage: 'connection' as const, outcome: 'not_created' as const };
  const ending = action === 'edit' ? ' The form was not changed.' : ' Nothing was created.';
  switch (reason) {
    case 'not_connected':
      return new FormEngineError({ ...base, code: 'provider_not_connected', message: `Google is not connected to your Intake account. Connect Google Forms first.${ending}`, retryable: false });
    case 'expired':
    case 'reauthorization_required':
      return new FormEngineError({ ...base, code: 'provider_reauthorization_required', message: `Your Google authorization has expired or was revoked. Reconnect Google, then try again.${ending}`, retryable: false });
    case 'not_configured':
      return new FormEngineError({ ...base, code: 'provider_not_configured', message: `Google is not set up on this Intake server yet.${ending}`, retryable: false });
    case 'provider_unavailable':
      return new FormEngineError({ ...base, code: 'provider_unavailable', message: `Google could not be reached to renew your authorization.${ending} Try again in a moment.`, retryable: true });
    case 'storage_unavailable':
      return new FormEngineError({ ...base, code: 'storage_unavailable', message: `Intake could not read your Google connection right now.${ending} Try again in a moment.`, retryable: true });
    default:
      return new FormEngineError({ ...base, code: 'unsupported_provider', message: 'That provider is not supported.', retryable: false });
  }
}

interface FailureContext {
  stage: BuildStage;
  operation: GoogleFormsOperation;
  formId: string | null;
  requestId: string;
  log: FormLogger;
  userId: string;
  connection: ConnectedGoogle;
  reportRejected: NonNullable<GoogleFormsProviderDeps['reportAuthorizationRejected']>;
}

/**
 * Turns whatever went wrong into one structured error that says what exists in Google now.
 * A form that was created and then not finished is left unpublished and reported, never hidden:
 * Intake has no scope to delete it, and the owner can open it from the link.
 */
async function failure(error: unknown, context: FailureContext): Promise<FormEngineError> {
  const { stage, formId } = context;
  const api = error instanceof GoogleFormsApiError ? error.info : null;
  const outcome = outcomeFor(api, stage, formId);
  const publishUnconfirmed = stage === 'publish' && !!api && (api.kind === 'timeout' || api.kind === 'network');
  const partialForm: PartialForm | undefined = formId ? { providerFormId: formId, editUrl: editUrl(formId), state: publishUnconfirmed ? 'publish_unconfirmed' : 'unpublished' } : undefined;

  const info = api ? describeApiFailure(api, stage) : { code: 'internal_error' as const, reason: 'Something unexpected went wrong inside Intake.', retryable: false as boolean };
  if (!api) logSafe('Google form creation failed unexpectedly', error);

  if (api?.kind === 'http' && api.httpStatus === 401) {
    try {
      await context.reportRejected(context.userId, 'google');
    } catch (reportError) {
      logSafe('Could not mark the Google connection for renewal', reportError);
    }
  }

  context.log('form.create.provider_failed', {
    requestId: context.requestId,
    provider: 'google',
    operation: context.operation,
    stage,
    formId,
    kind: api?.kind ?? 'internal',
    httpStatus: api?.httpStatus,
    googleStatus: api?.googleStatus,
    reason: api?.reason,
    detail: api?.detail,
    outcome,
    code: info.code,
  });

  const message = `${STAGE_FAILED[stage]} ${info.reason}${outcomeText(outcome, partialForm?.state)}`;
  const failureInfo: FormErrorInfo = {
    code: info.code,
    message,
    provider: 'google',
    stage,
    outcome,
    retryable: info.retryable && outcome === 'not_created',
  };
  if (info.detail) failureInfo.detail = info.detail;
  if (info.retryAfterSeconds && failureInfo.retryable) failureInfo.retryAfterSeconds = info.retryAfterSeconds;
  if (partialForm) failureInfo.partialForm = partialForm;
  return new FormEngineError(failureInfo, { externalAccountId: context.connection.externalAccountId });
}

function outcomeFor(api: GoogleFormsApiError['info'] | null, stage: BuildStage, formId: string | null): FormOutcome {
  if (formId) return 'partial';
  if (stage !== 'create') return 'not_created';
  if (!api) return 'unknown';
  if (api.kind === 'http') return (api.httpStatus ?? 500) >= 500 ? 'unknown' : 'not_created';
  // A timeout, dropped connection or unreadable success response: Google may have created the form.
  return 'unknown';
}

function outcomeText(outcome: FormOutcome, state: PartialForm['state'] | undefined): string {
  if (outcome === 'not_created') return ' Nothing was created.';
  if (outcome === 'unknown') return ' Google did not confirm the request, so a form may or may not exist. Check Google Forms before trying again.';
  if (state === 'publish_unconfirmed') return ' Google did not confirm whether it published the form. Open it in Google Forms to check.';
  return ' A partly built form exists in your Google account and is not published. Open it to finish or delete it.';
}

function describeApiFailure(api: GoogleFormsApiError['info'], stage: BuildStage): { code: FormErrorInfo['code']; reason: string; retryable: boolean; detail?: string; retryAfterSeconds?: number } {
  if (api.kind === 'timeout' || api.kind === 'network') {
    return { code: 'provider_unavailable', reason: api.kind === 'timeout' ? 'Google took too long to answer.' : 'Google could not be reached.', retryable: true };
  }
  if (api.kind === 'malformed_response') {
    return { code: 'provider_error', reason: 'Google answered in a way Intake could not use.', retryable: false };
  }
  const status = api.httpStatus ?? 0;
  if (status === 401) {
    return { code: 'provider_reauthorization_required', reason: 'Google no longer accepts Intake\'s authorization. Reconnect Google, then try again.', retryable: false };
  }
  if (status === 403) {
    if (api.reason === 'SERVICE_DISABLED' || api.reason === 'API_DISABLED') {
      return { code: 'provider_permission_denied', reason: 'The Google Forms API is not enabled for the Google Cloud project Intake uses. An administrator needs to enable it.', retryable: false };
    }
    if (api.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
      return { code: 'provider_reauthorization_required', reason: 'Google did not grant Intake permission to manage forms. Reconnect Google and allow the requested access.', retryable: false };
    }
    return { code: 'provider_permission_denied', reason: 'Google refused permission to create forms in this account. Your account or organization may restrict Google Forms.', retryable: false };
  }
  if (status === 404) {
    return { code: 'provider_rejected', reason: 'Google could not find the form. It may have been deleted while it was being built.', retryable: false };
  }
  if (status === 429) {
    return { code: 'provider_rate_limited', reason: 'Google is limiting requests right now. Wait a minute and try again.', retryable: true,
      ...(api.retryAfterSeconds ? { retryAfterSeconds: api.retryAfterSeconds } : {}) };
  }
  if (status >= 500) {
    return { code: 'provider_error', reason: 'Google had a temporary problem.', retryable: true };
  }
  return {
    code: 'provider_rejected',
    reason: stage === 'create' ? 'Google rejected the request.' : 'Google rejected part of the form.',
    retryable: false,
    ...(api.detail ? { detail: api.detail } : {}),
  };
}
