import { randomUUID } from 'node:crypto';
import { safeFormUrl } from '../../src/lib/forms';
import { logSafe } from '../providers/oauth';
import { editChanges, toFormEditView, type FormEditFailure, type FormEditResult, type FormEditSnapshot, type PublicFormEditDraft } from '../../src/lib/form-edit';
import type { FormStore } from './store';
import type { FormsProviders, LoadedEditableForm } from './provider';
import type { FormEditDraftRecord, FormEditDraftStore, NewFormEditDraft, StoredEditStatus } from './edit-store';
import { FormEditError, toFormEditFailure } from './edit-errors';
import { createFormLogger, newRequestId, type FormLogger } from './logging';
import { assessFormEditInterpretation, type FormEditInterpreter, type FormEditInterpretationResult } from './interpretation/edit-interpreter';
import { InterpretationError } from './interpretation/interpreter';
import type { AiOperationRunner } from '../ai/operations';
import { CreditError, type CreditService } from '../credits/service';
import { costForFormEdit, editComplexity } from '../credits/pricing';
import type { PublicOperationCost } from '../../src/lib/credits';

export type FormEditTarget = { kind: 'record'; formRecordId: string } | { kind: 'url'; formUrl: string };
export type EditInterpretationOutcome =
  // `credits` is the server-owned balance after the single charge for this logical operation.
  | { status: 'ready'; draft: PublicFormEditDraft; credits?: unknown; operationCost?: PublicOperationCost }
  | { status: 'needs_clarification'; question: string; operationCost?: PublicOperationCost }
  | { status: 'unsupported'; explanation: string; operationCost?: PublicOperationCost };

export interface FormEditEngineDeps {
  providers: FormsProviders;
  forms: FormStore;
  drafts: FormEditDraftStore;
  interpreter: FormEditInterpreter;
  log?: FormLogger;
  now?: () => Date;
  newId?: () => string;
  /** Server-side AI credit accounting. Absent only in isolated tests. */
  operations?: AiOperationRunner;
  /** Used to build the public balance returned with a successful operation. */
  credits?: CreditService;
}

const FORM_RECORD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only parses an exact Google Forms edit/view URL; this function never fetches or follows user URLs. */
export function extractGoogleFormId(formUrl: unknown): string | null {
  if (typeof formUrl !== 'string' || formUrl.length > 2048) return null;
  try {
    const url = new URL(formUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || url.hash) return null;
    const match = /^\/forms\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{8,256})\/(?:edit|viewform)\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch { return null; }
}

function publicDraft(row: FormEditDraftRecord): PublicFormEditDraft {
  const current = toFormEditView(row.current);
  return {
    id: row.id, provider: 'google', version: row.version, status: row.status, current,
    plan: row.plan, changes: editChanges(row.plan, current), result: row.result,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function editFailureInfo(failure: FormEditFailure) {
  return { code: failure.code, message: failure.error, ...(failure.outcome ? { outcome: failure.outcome } : {}),
    ...(typeof failure.retryable === 'boolean' ? { retryable: failure.retryable } : {}),
    ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    ...(failure.issues ? { issues: failure.issues } : {}) };
}

function modelFailure(error: unknown): FormEditError {
  if (error instanceof FormEditError) return error;
  if (error instanceof InterpretationError) {
    return new FormEditError({ code: error.code, message: error.message, outcome: 'not_applied', retryable: error.code !== 'model_not_configured' });
  }
  return new FormEditError({ code: 'model_unavailable', message: 'Intake could not interpret the requested changes. The Google Form was not changed.', outcome: 'not_applied', retryable: true });
}

function requestContext(requestId: string, log: FormLogger) {
  return { requestId, log };
}

function hasEditSurface(provider: FormsProviders['google']): boolean {
  return provider.id === 'google' && provider.capabilities.editForm === true && !!provider.retrieveForm && !!provider.applyEditPlan;
}

function requireEditProvider(providers: FormsProviders): FormsProviders['google'] {
  const provider = providers.google;
  if (!hasEditSurface(provider)) throw new FormEditError({ code: 'edit_unsupported', message: provider.capabilities.editNote ?? 'Editing forms with this provider is not supported.', outcome: 'not_applied', retryable: false });
  return provider;
}

function interpretFailure(error: unknown): FormEditError {
  return modelFailure(error);
}

function staleFailure(): FormEditError {
  return new FormEditError({ code: 'edit_stale', message: 'This Google Form changed while Intake was preparing the proposal. Nothing was applied. Refresh the form and review a new proposal.', outcome: 'stale', retryable: false });
}

function storedFailure(row: FormEditDraftRecord): FormEditError | null {
  if (row.result?.ok === false) return new FormEditError(editFailureInfo(row.result.failure));
  if (row.status === 'applying') return new FormEditError({ code: 'edit_draft_locked', message: 'An edit attempt started, but Intake has not confirmed its result. Do not submit it again. Check the original Google Form before starting another edit.', outcome: 'unknown', retryable: false });
  if (row.status === 'blocked') return new FormEditError({ code: 'edit_draft_locked', message: 'The edit result is uncertain or partial. Intake will not retry it. Check the original form and prepare a fresh proposal for any remaining work.', outcome: 'unknown', retryable: false });
  if (row.status === 'stale') return staleFailure();
  return null;
}

export function createFormEditEngine(deps: FormEditEngineDeps) {
  const log = deps.log ?? createFormLogger();
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;

  async function inspect(userId: string, target: FormEditTarget, requestId = newRequestId()): Promise<{ loaded: LoadedEditableForm; formRecordId: string | null }> {
    const provider = requireEditProvider(deps.providers);
    let providerFormId: string;
    let formRecordId: string | null = null;
    let storedRecord: Awaited<ReturnType<FormStore['getForUser']>> = null;
    if (target.kind === 'record') {
      if (!FORM_RECORD_ID.test(target.formRecordId)) throw new FormEditError({ code: 'invalid_request', message: 'Select one of your Intake forms or paste a valid Google Forms edit URL.', outcome: 'not_applied', retryable: false });
      storedRecord = await deps.forms.getForUser(userId, target.formRecordId);
      if (!storedRecord) throw new FormEditError({ code: 'form_not_found', message: 'That form is not available in your Intake account. Choose one of your forms or paste a Google Forms edit URL.', outcome: 'not_applied', retryable: false });
      if (storedRecord.provider !== 'google') throw new FormEditError({ code: 'edit_unsupported', message: 'Intake only supports editing Google Forms. Microsoft Forms editing is unavailable.', outcome: 'not_applied', retryable: false });
      providerFormId = storedRecord.providerFormId;
      formRecordId = storedRecord.id;
    } else {
      const id = extractGoogleFormId(target.formUrl);
      if (!id) throw new FormEditError({ code: 'invalid_form_url', message: 'Paste a Google Forms edit URL such as https://docs.google.com/forms/d/FORM_ID/edit. Short links and other URLs are not fetched.', outcome: 'not_applied', retryable: false });
      providerFormId = id;
    }
    let loaded: LoadedEditableForm;
    try {
      loaded = await provider.retrieveForm!(userId, providerFormId, requestContext(requestId, log));
    } catch (error) {
      if (error instanceof FormEditError) throw error;
      throw new FormEditError({ code: 'provider_unavailable', message: 'Intake could not retrieve the current Google Form. No changes were made.', outcome: 'not_applied', retryable: true });
    }
    if (loaded.current.providerFormId !== providerFormId) throw new FormEditError({ code: 'provider_error', message: 'Google returned a different form than the one selected. Intake refused to continue.', outcome: 'not_applied', retryable: false });
    if (storedRecord && storedRecord.externalAccountId !== loaded.externalAccountId) throw new FormEditError({ code: 'form_not_editable', message: 'The connected Google account is not the account that owns this Intake form. Reconnect the original account and try again.', outcome: 'not_applied', retryable: false });
    if (storedRecord && !loaded.current.responderUrl && storedRecord.responderUrl && safeFormUrl(storedRecord.responderUrl)) loaded.current.responderUrl = storedRecord.responderUrl;
    return { loaded, formRecordId };
  }

  /**
   * One logical edit operation. The engine keeps owning the model call and its strict assessment; this
   * wrapper adds provider-independent usage accounting and, only for a validated plan, one credit charge.
   */
  async function interpretPlan(input: {
    userId: string;
    operationType: 'form_edit' | 'form_revise';
    operationId?: string;
    current: FormEditSnapshot;
    request: string;
    clarification?: string;
    existingPlan?: { summary: string; operations: unknown };
  }): Promise<{ result: FormEditInterpretationResult; credits: unknown; operationCost?: PublicOperationCost }> {
    const execute = async (): Promise<{ kind: 'usable'; value: FormEditInterpretationResult; cost: number } | { kind: 'no_result'; value: FormEditInterpretationResult }> => {
      const assessed = assessFormEditInterpretation(await deps.interpreter.interpret({
        current: input.current,
        request: input.request,
        ...(input.clarification ? { clarification: input.clarification } : {}),
        ...(input.existingPlan ? { existingPlan: input.existingPlan as never } : {}),
      }), input.current);
      return assessed.status === 'ready'
        ? { kind: 'usable', value: assessed, cost: costForFormEdit(editComplexity(assessed.plan)) }
        : { kind: 'no_result', value: assessed };
    };
    if (!deps.operations) {
      const outcome = await execute();
      return { result: outcome.value, credits: undefined };
    }
    const outcome = await deps.operations.run({
      userId: input.userId,
      operationType: input.operationType,
      operationKey: deps.operations.operationKey(input.operationId),
      execute,
    });
    if (!outcome.ok) {
      if (outcome.error instanceof CreditError) {
        throw new FormEditError({ code: outcome.error.code, message: outcome.error.message, outcome: 'not_applied', retryable: outcome.error.code !== 'insufficient_credits' });
      }
      throw interpretFailure(outcome.error);
    }
    return {
      result: outcome.value,
      credits: outcome.charge.balance,
      operationCost: { credits: outcome.charge.cost, status: outcome.charge.status },
    };
  }

  return {
    inspect(userId: string, target: FormEditTarget, requestId?: string) {
      return inspect(userId, target, requestId);
    },

    async interpret(userId: string, input: { target: FormEditTarget; request: string; clarification?: string; operationId?: string }, requestId = newRequestId()): Promise<EditInterpretationOutcome> {
      const started = performance.now();
      const { loaded, formRecordId } = await inspect(userId, input.target, requestId);
      log('form.edit.interpret.started', { requestId, userId, provider: 'google', formId: loaded.current.providerFormId, mode: 'new' });
      let interpreted;
      try {
        interpreted = await interpretPlan({
          userId, operationType: 'form_edit', current: loaded.current, request: input.request,
          ...(input.operationId ? { operationId: input.operationId } : {}),
          ...(input.clarification ? { clarification: input.clarification } : {}),
        });
      } catch (error) {
        const failure = error instanceof FormEditError ? error : interpretFailure(error);
        log('form.edit.interpret.failed', { requestId, userId, provider: 'google', formId: loaded.current.providerFormId, code: failure.info.code, durationMs: Math.round(performance.now() - started) });
        throw failure;
      }
      const result = interpreted.result;
      if (result.status === 'needs_clarification') {
        log('form.edit.interpret.clarification', { requestId, userId, provider: 'google', formId: loaded.current.providerFormId, durationMs: Math.round(performance.now() - started) });
        return result;
      }
      if (result.status === 'unsupported') {
        log('form.edit.interpret.unsupported', { requestId, userId, provider: 'google', formId: loaded.current.providerFormId, durationMs: Math.round(performance.now() - started) });
        return { ...result, ...(interpreted.operationCost ? { operationCost: interpreted.operationCost } : {}) };
      }
      const draftInput: NewFormEditDraft = {
        id: newId(), userId, provider: 'google', providerFormId: loaded.current.providerFormId, formRecordId,
        externalAccountId: loaded.externalAccountId, current: loaded.current, plan: result.plan,
      };
      let saved: FormEditDraftRecord;
      try { saved = await deps.drafts.create(draftInput, now()); }
      catch {
        throw new FormEditError({ code: 'storage_unavailable', message: 'Intake could not save the proposal. The Google Form was not changed. Try again.', outcome: 'not_applied', retryable: true });
      }
      log('form.edit.interpret.completed', { requestId, userId, provider: 'google', formId: loaded.current.providerFormId, operationCount: result.plan.operations.length, durationMs: Math.round(performance.now() - started) });
      return {
        status: 'ready',
        draft: publicDraft(saved),
        ...(interpreted.credits ? { credits: interpreted.credits } : {}),
        ...(interpreted.operationCost ? { operationCost: interpreted.operationCost } : {}),
      };
    },

    async revise(userId: string, input: { draftId: string; version: number; request: string; clarification?: string; operationId?: string }, requestId = newRequestId()): Promise<EditInterpretationOutcome> {
      if (!DRAFT_ID.test(input.draftId)) throw new FormEditError({ code: 'edit_draft_not_found', message: 'This edit proposal is not available in your Intake account.', outcome: 'not_applied', retryable: false });
      const draft = await deps.drafts.get(userId, input.draftId);
      if (!draft) throw new FormEditError({ code: 'edit_draft_not_found', message: 'This edit proposal is not available in your Intake account.', outcome: 'not_applied', retryable: false });
      if (draft.status !== 'ready') throw new FormEditError({ code: 'edit_draft_locked', message: 'This proposal can no longer be revised. Load the current Google Form and prepare a fresh edit.', outcome: draft.status === 'stale' ? 'stale' : 'unknown', retryable: false });
      if (draft.version !== input.version) throw new FormEditError({ code: 'edit_draft_conflict', message: 'This proposal changed in another tab. Reload it before revising.', outcome: 'not_applied', retryable: false });
      const provider = requireEditProvider(deps.providers);
      const latest = await provider.retrieveForm!(userId, draft.providerFormId, requestContext(requestId, log));
      if (latest.externalAccountId !== draft.externalAccountId || latest.current.revisionId !== draft.current.revisionId) {
        const failure = staleFailure();
        const result: FormEditResult = { ok: false, failure: toFormEditFailure(failure.info, requestId) };
        await deps.drafts.markStale(userId, draft.id, draft.version, result, now());
        log('form.edit.stale', { requestId, userId, provider: 'google', formId: draft.providerFormId, phase: 'revise' });
        throw failure;
      }
      const started = performance.now();
      log('form.edit.interpret.started', { requestId, userId, provider: 'google', formId: draft.providerFormId, mode: 'revise' });
      let interpreted;
      try {
        interpreted = await interpretPlan({
          userId, operationType: 'form_revise', current: latest.current, request: input.request, existingPlan: draft.plan,
          ...(input.operationId ? { operationId: input.operationId } : {}),
          ...(input.clarification ? { clarification: input.clarification } : {}),
        });
      } catch (error) {
        const failure = error instanceof FormEditError ? error : interpretFailure(error);
        log('form.edit.interpret.failed', { requestId, userId, provider: 'google', formId: draft.providerFormId, code: failure.info.code, durationMs: Math.round(performance.now() - started) });
        throw failure;
      }
      const result = interpreted.result;
      if (result.status !== 'ready') {
        log(result.status === 'needs_clarification' ? 'form.edit.interpret.clarification' : 'form.edit.interpret.unsupported', { requestId, userId, provider: 'google', formId: draft.providerFormId, durationMs: Math.round(performance.now() - started) });
        return { ...result, ...(interpreted.operationCost ? { operationCost: interpreted.operationCost } : {}) };
      }
      const updated = await deps.drafts.revise(userId, draft.id, draft.version, result.plan, now());
      if (!updated) throw new FormEditError({ code: 'edit_draft_conflict', message: 'This proposal changed while Intake was revising it. Reload the proposal before continuing.', outcome: 'not_applied', retryable: false });
      log('form.edit.revised', { requestId, userId, provider: 'google', formId: draft.providerFormId, operationCount: result.plan.operations.length, version: updated.version });
      return {
        status: 'ready',
        draft: publicDraft(updated),
        ...(interpreted.credits ? { credits: interpreted.credits } : {}),
        ...(interpreted.operationCost ? { operationCost: interpreted.operationCost } : {}),
      };
    },

    async getDraft(userId: string, id: string): Promise<PublicFormEditDraft | null> {
      if (!DRAFT_ID.test(id)) return null;
      const row = await deps.drafts.get(userId, id);
      return row ? publicDraft(row) : null;
    },

    async discard(userId: string, id: string): Promise<boolean> {
      if (!DRAFT_ID.test(id)) return false;
      return deps.drafts.discard(userId, id);
    },

    async confirm(userId: string, input: { draftId: string; version: number; confirm: true }, requestId = newRequestId()): Promise<FormEditResult> {
      if (!DRAFT_ID.test(input.draftId)) throw new FormEditError({ code: 'edit_draft_not_found', message: 'This edit proposal is not available in your Intake account.', outcome: 'not_applied', retryable: false });
      const draft = await deps.drafts.get(userId, input.draftId);
      if (!draft) throw new FormEditError({ code: 'edit_draft_not_found', message: 'This edit proposal is not available in your Intake account.', outcome: 'not_applied', retryable: false });
      if (draft.version !== input.version) throw new FormEditError({ code: 'edit_draft_conflict', message: 'This proposal changed in another tab. Reload it before applying changes.', outcome: 'not_applied', retryable: false });
      if (draft.status === 'applied' && draft.result?.ok) return draft.result;
      if (draft.status === 'blocked' || draft.status === 'stale' || draft.status === 'applying') {
        const failure = storedFailure(draft);
        throw failure ?? new FormEditError({ code: 'edit_draft_locked', message: 'This edit proposal is locked. Check the original form before continuing.', outcome: 'unknown', retryable: false });
      }
      const claimed = await deps.drafts.claim(userId, draft.id, draft.version, now());
      if (!claimed) throw new FormEditError({ code: 'edit_draft_conflict', message: 'This proposal was already submitted or revised. Reload it before applying changes.', outcome: 'not_applied', retryable: false });
      log('form.edit.apply_started', { requestId, userId, provider: 'google', formId: claimed.providerFormId, version: claimed.version, operationCount: claimed.plan.operations.length });
      let result: FormEditResult;
      let status: StoredEditStatus;
      let updatedSnapshot: FormEditSnapshot | undefined;
      try {
        const provider = requireEditProvider(deps.providers);
        const updated = await provider.applyEditPlan!(userId, { base: claimed.current, plan: claimed.plan, expectedAccountId: claimed.externalAccountId }, requestContext(requestId, log));
        if (updated.current.providerFormId !== claimed.providerFormId || claimed.plan.formId !== claimed.providerFormId) {
          throw new FormEditError({ code: 'provider_error', message: 'Google returned a different form after the update. Intake cannot claim the edit succeeded. Check the original Google Form before taking further action.', outcome: 'unknown', retryable: false });
        }
        updatedSnapshot = updated.current;
        let recordUpdated = false;
        let targetRecordId = claimed.formRecordId;
        if (!targetRecordId && deps.forms.getByProviderFormId) {
          try {
            const found = await deps.forms.getByProviderFormId(userId, 'google', claimed.providerFormId);
            if (found) targetRecordId = found.id;
          } catch { /* ignore */ }
        }
        if (targetRecordId) {
          try {
            recordUpdated = await deps.forms.updateMetadata({ userId, id: targetRecordId, providerFormId: claimed.providerFormId,
              externalAccountId: claimed.externalAccountId, title: updated.current.title, editUrl: updated.current.editUrl,
              responderUrl: updated.current.responderUrl ?? claimed.current.responderUrl,
              description: updated.current.description }, now());
          } catch (error) {
            logSafe('Could not update Intake form metadata after Google confirmed the edit', error);
          }
        }
        result = { ok: true, requestId, providerFormId: claimed.providerFormId, title: updated.current.title,
          editUrl: updated.current.editUrl, responderUrl: updated.current.responderUrl ?? claimed.current.responderUrl ?? null, recordUpdated };
        status = 'applied';
      } catch (error) {
        const failure = error instanceof FormEditError ? error : new FormEditError({ code: 'internal_error', message: 'Intake could not confirm whether the edit was applied. Check the original Google Form before taking further action.', outcome: 'unknown', retryable: false });
        if (failure.info.current) updatedSnapshot = failure.info.current;
        result = { ok: false, failure: toFormEditFailure(failure.info, requestId) };
        status = failure.info.outcome === 'not_applied' ? 'ready' : failure.info.outcome === 'stale' ? 'stale' : 'blocked';
        log('form.edit.apply_failed', { requestId, userId, provider: 'google', formId: claimed.providerFormId, code: failure.info.code, outcome: failure.info.outcome });
      }
      try {
        if (!await deps.drafts.finish(userId, claimed.id, status, result, now(), updatedSnapshot)) throw new Error('edit draft claim was lost');
      } catch (error) {
        logSafe('Saving the edit attempt result failed', error);
        log('form.edit.result_not_saved', { requestId, userId, provider: 'google', formId: claimed.providerFormId, outcome: result.ok ? 'applied' : result.failure.outcome });
        if (result.ok) return result; // Google's update and a fresh provider read were confirmed; the DB remains locked at applying.
        throw new FormEditError({ code: 'storage_unavailable', message: 'Intake could not save the edit attempt result. Do not retry this proposal. Check the original Google Form before starting a new edit.', outcome: 'unknown', retryable: false });
      }
      const finalDraft = await deps.drafts.get(userId, claimed.id);
      log(result.ok ? 'form.edit.apply_completed' : 'form.edit.apply_failed', { requestId, userId, provider: 'google', formId: claimed.providerFormId, outcome: result.ok ? 'applied' : result.failure.outcome, recorded: !!finalDraft });
      if (!result.ok) throw new FormEditError(editFailureInfo(result.failure));
      return result;
    },

  };
}
