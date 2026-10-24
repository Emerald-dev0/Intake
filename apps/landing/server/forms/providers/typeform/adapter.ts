import { safeFormUrl } from '../../../../src/lib/forms';
import { hasScope, logSafe } from '../../../providers/oauth';
import { getProviderConnection, reportProviderAuthorizationRejected, type AuthorizedConnection } from '../../../providers/service';
import { FormEngineError, type FormErrorInfo } from '../../errors';
import { createFormLogger, newRequestId, type FormLogger } from '../../logging';
import { TypeformApiError, createTypeformClient, type TypeformApiErrorInfo, type TypeformClient, type TypeformOperation, type TypeformFormResource } from './client';
import { planTypeform } from './plan';
import type { CreatedForm, FormsProvider } from '../../provider';
import type { FormSpecification } from '../../specification';
import type { FormEditErrorCode, FormEditPlan, FormEditSnapshot } from '../../../../src/lib/form-edit';
import { ensureValidatedSpecification } from '../../validation';
import { FormEditError } from '../../edit-errors';
import { validateFormEditPlan } from '../../edit-validation';
import { compileTypeformEdit, refuseUnsafeTypeformOperation, typeformEditSnapshot, typeformUnchanged, verifyTypeformEdit, TYPEFORM_EDIT_NOTE } from './edit';

export const TYPEFORM_SCOPE = 'forms:write';

export interface TypeformProviderDeps {
  getConnection?: (userId: string, provider: string) => Promise<AuthorizedConnection>;
  reportAuthorizationRejected?: (userId: string, provider: string) => Promise<void>;
  client?: TypeformClient;
}

type ConnectedTypeform = Extract<AuthorizedConnection, { ok: true }>;
type BuildStage = 'create' | 'add_questions' | 'configure_logic' | 'publish';

const STAGE_FAILED: Record<BuildStage, string> = {
  create: 'Typeform could not create the form.',
  add_questions: 'Typeform created an empty form but did not accept the fields.',
  configure_logic: 'The fields were added, but Typeform did not accept the logic.',
  publish: 'The form was built, but Typeform did not publish it.',
};

export function createTypeformProvider(deps: TypeformProviderDeps = {}): FormsProvider {
  const getConnection = deps.getConnection ?? getProviderConnection;
  const reportRejected = deps.reportAuthorizationRejected ?? reportProviderAuthorizationRejected;
  const client = deps.client ?? createTypeformClient();
  const fallbackLog = createFormLogger();

  return {
    id: 'typeform',
    capabilities: { createForm: true, editForm: true, editNote: TYPEFORM_EDIT_NOTE },

    async retrieveForm(userId: string, providerFormId: string, context?: { requestId?: string; log?: FormLogger }) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;
      if (!isTypeformId(providerFormId)) throw new FormEngineError({ code: 'invalid_request', message: 'That Typeform URL does not contain a valid form ID.', provider: 'typeform', outcome: 'not_created', retryable: false });
      const connection = await acquireConnection(getConnection, userId);
      try {
        log('form.create.provider_request', { requestId, userId, provider: 'typeform', operation: 'forms.get', formId: providerFormId, stage: 'retrieve' });
        const resource = await client.getForm(connection.accessToken, providerFormId);
        return { current: typeformEditSnapshot(resource), externalAccountId: connection.externalAccountId };
      } catch (error) {
        if (error instanceof FormEngineError) throw error;
        const api = error instanceof TypeformApiError ? error.info : null;
        if (!api) {
          logSafe('Typeform form retrieval failed unexpectedly', error);
          throw new FormEngineError({ code: 'internal_error', message: 'Intake could not read this Typeform.', provider: 'typeform', outcome: 'not_created', retryable: false });
        }
        if (api.kind === 'http' && api.httpStatus === 401) {
          try { await reportRejected(userId, 'typeform'); } catch { }
        }
        const code = mapTypeformReadError(api);
        throw new FormEngineError({ code, message: mapTypeformErrorMessage(api), provider: 'typeform', outcome: 'not_created', retryable: api.kind === 'timeout' || api.kind === 'network' || (api.kind === 'http' && (api.httpStatus ?? 0) >= 500) });
      }
    },

    /**
     * Typeform editing is a read-modify-write. The live form is read here, immediately before the
     * write, and the payload is compiled from that read — never from the stored proposal — so every
     * setting, logic jump, screen and untouched question is echoed back instead of being dropped.
     */
    async applyEditPlan(userId: string, input: { base: FormEditSnapshot; plan: FormEditPlan; expectedAccountId: string }, context?: { requestId?: string; log?: FormLogger }) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;
      if (!isTypeformId(input.base.providerFormId) || input.plan.formId !== input.base.providerFormId) {
        throw new FormEditError({ code: 'edit_plan_invalid', message: 'The plan does not target the selected Typeform. Nothing was changed.', outcome: 'not_applied', retryable: false });
      }
      let connection: ConnectedTypeform;
      try {
        connection = await acquireConnection(getConnection, userId);
      } catch (error) {
        // A connection failure must not look like an unknown write outcome: nothing was sent.
        throw editConnectionFailure(error);
      }
      if (connection.externalAccountId !== input.expectedAccountId) {
        throw new FormEditError({ code: 'form_not_editable', message: 'The connected Typeform account changed after this proposal was prepared. Reconnect the original account and review the form again.', outcome: 'not_applied', retryable: false });
      }
      const token = connection.accessToken;
      const stale = () => new FormEditError({ code: 'edit_stale', message: 'This Typeform changed after Intake prepared the proposal. Nothing was applied. Refresh the current form and review a new proposal.', outcome: 'stale', retryable: false });

      log('form.edit.provider_request', { requestId, userId, provider: 'typeform', operation: 'forms.get', formId: input.base.providerFormId, stage: 'verify_before_apply' });
      let fresh: TypeformFormResource;
      try {
        fresh = await client.getForm(token, input.base.providerFormId);
      } catch (error) {
        throw typeformEditFailure(error, 'Intake could not read the current Typeform. Nothing was changed.');
      }
      const snapshot = typeformEditSnapshot(fresh);
      if (!typeformUnchanged(input.base, snapshot)) throw stale();

      const refusal = refuseUnsafeTypeformOperation(fresh, input.plan);
      if (refusal) throw new FormEditError({ code: 'edit_unsupported', message: refusal, outcome: 'not_applied', retryable: false });
      const validation = validateFormEditPlan(snapshot, { summary: input.plan.summary, operations: input.plan.operations });
      if (!validation.ok) {
        throw new FormEditError({ code: validation.kind === 'unsupported' ? 'edit_unsupported' : 'edit_plan_invalid',
          message: validation.issues.slice(0, 4).map(issue => issue.message).join(' ') || 'This proposal no longer passes validation. Nothing was changed.',
          outcome: 'not_applied', retryable: false, issues: validation.issues });
      }
      let compiled: ReturnType<typeof compileTypeformEdit>;
      try {
        compiled = compileTypeformEdit(fresh, input.plan);
      } catch (error) {
        throw new FormEditError({ code: 'edit_plan_invalid', message: error instanceof Error ? error.message : 'This proposal cannot be built from the current form. Nothing was changed.', outcome: 'not_applied', retryable: false });
      }

      let updated: TypeformFormResource | null = null;
      let writeError: unknown = null;
      try {
        log('form.edit.provider_request', { requestId, userId, provider: 'typeform', operation: 'forms.update', formId: fresh.id, stage: 'apply', fieldCount: compiled.payload.fields.length });
        updated = await client.updateForm(token, fresh.id, {
          title: compiled.payload.title,
          fields: compiled.payload.fields,
          settings: compiled.payload.settings,
          theme: compiled.payload.theme as never,
          welcomeScreens: compiled.payload.welcome_screens,
          thankYouScreens: compiled.payload.thankyou_screens,
          logic: compiled.payload.logic,
        });
      } catch (error) {
        writeError = error;
      }

      if (!updated) {
        // A timeout or a dropped response does not tell us whether the PUT landed. One read decides,
        // and it never repeats the write.
        let recovered: TypeformFormResource | null = null;
        try {
          recovered = await client.getForm(token, fresh.id);
        } catch {
          log('form.edit.provider_failed', { requestId, userId, provider: 'typeform', operation: 'forms.update', formId: fresh.id, stage: 'reconcile', outcome: 'unknown' });
          throw new FormEditError({ code: 'provider_unavailable', message: 'Typeform did not confirm the update, and Intake could not read the form back to check. Do not retry this proposal; open the form in Typeform first.', outcome: 'unknown', retryable: false });
        }
        const verdict = verifyTypeformEdit(fresh, recovered, compiled.expected, input.plan);
        if (verdict.ok) {
          log('form.edit.completed', { requestId, userId, provider: 'typeform', formId: fresh.id, operationCount: input.plan.operations.length, recovered: true });
          return { current: typeformEditSnapshot(recovered), externalAccountId: connection.externalAccountId };
        }
        throw typeformEditFailure(writeError, 'Typeform did not apply the proposal. Nothing was changed.');
      }

      const verdict = verifyTypeformEdit(fresh, updated, compiled.expected, input.plan);
      if (!verdict.ok) {
        // Losing a field is the failure this whole design exists to prevent: block, never retry.
        if (verdict.reason === 'missing_fields' || verdict.reason === 'changed_fields') {
          log('form.edit.provider_failed', { requestId, userId, provider: 'typeform', operation: 'forms.update', formId: fresh.id, stage: 'verify_after_apply', outcome: 'partial', reason: verdict.reason });
          throw new FormEditError({ code: 'provider_error', message: `Typeform accepted the update, but the form that came back does not match the proposal. ${verdict.detail} Do not retry this proposal; check the form in Typeform.`, outcome: 'partial', retryable: false });
        }
        log('form.edit.provider_failed', { requestId, userId, provider: 'typeform', operation: 'forms.update', formId: fresh.id, stage: 'verify_after_apply', outcome: 'unknown', reason: verdict.reason });
        throw new FormEditError({ code: 'provider_unavailable', message: `Typeform accepted the update but Intake could not verify it. ${verdict.detail} Do not retry this proposal; check the form in Typeform first.`, outcome: 'unknown', retryable: false });
      }
      log('form.edit.completed', { requestId, userId, provider: 'typeform', formId: fresh.id, operationCount: input.plan.operations.length });
      return { current: typeformEditSnapshot(updated), externalAccountId: connection.externalAccountId };
    },

    async createForm(userId: string, specification: unknown, context?: { requestId?: string; log?: FormLogger }) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;

      const spec: FormSpecification = ensureValidatedSpecification(specification);
      const planned = planTypeform(spec);
      if (!planned.ok) {
        throw new FormEngineError({
          code: 'unsupported_by_provider',
          message: 'Typeform cannot express this form as written. Nothing was created.',
          issues: planned.issues,
          provider: 'typeform',
          outcome: 'not_created',
          retryable: false,
        });
      }
      const plan = planned.plan;

      const connection = await acquireConnection(getConnection, userId);
      const token = connection.accessToken;

      let stage: BuildStage = 'create';
      let formId: string | null = null;
      let operation: TypeformOperation = 'forms.create';
      try {
        log('form.create.provider_request', { requestId, userId, provider: 'typeform', operation, stage, formId: null, questionCount: plan.fields.length });
        const created = await client.createForm(token, { title: plan.title, fields: plan.fields, settings: plan.settings, welcomeScreens: plan.welcomeScreens, thankYouScreens: plan.thankYouScreens, logic: plan.logic });
        formId = created.id;
        stage = 'publish';

        const result: CreatedForm = {
          provider: 'typeform',
          providerFormId: formId,
          title: plan.title,
          editUrl: editUrl(formId),
          published: true,
          warnings: plan.warnings,
          externalAccountId: connection.externalAccountId,
        };
        const displayUrl = safeFormUrl(created._links?.display);
        if (displayUrl) result.responderUrl = displayUrl;
        return result;
      } catch (error) {
        throw await failure(error, { stage, operation, formId, requestId, log, userId, connection, reportRejected });
      }
    },
  };
}

function isTypeformId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9]{8,}$/.test(value);
}

async function acquireConnection(getConnection: NonNullable<TypeformProviderDeps['getConnection']>, userId: string): Promise<ConnectedTypeform> {
  let result: AuthorizedConnection;
  try {
    result = await getConnection(userId, 'typeform');
  } catch (error) {
    logSafe('Forms connection lookup failed', error);
    throw new FormEngineError({
      code: 'storage_unavailable',
      message: 'Intake could not read your Typeform connection right now. Nothing was created.',
      provider: 'typeform',
      stage: 'connection',
      outcome: 'not_created',
      retryable: true,
    });
  }
  if (!result.ok) throw connectionError(result.reason);
  if (result.provider !== 'typeform' || result.userId !== userId) {
    logSafe('Forms connection ownership mismatch');
    throw new FormEngineError({ code: 'internal_error', message: 'Intake could not verify which Typeform connection to use. Nothing was created.', provider: 'typeform', stage: 'connection', outcome: 'not_created', retryable: false });
  }
  if (!hasScope(result.scopes, TYPEFORM_SCOPE)) {
    throw connectionError('reauthorization_required');
  }
  return result;
}

type ConnectionFailure = Extract<AuthorizedConnection, { ok: false }>['reason'];

function connectionError(reason: ConnectionFailure): FormEngineError {
  const base = { provider: 'typeform' as const, stage: 'connection' as const, outcome: 'not_created' as const };
  switch (reason) {
    case 'not_connected':
      return new FormEngineError({ ...base, code: 'provider_not_connected', message: 'Typeform is not connected to your Intake account. Connect Typeform first.', retryable: false });
    case 'expired':
    case 'reauthorization_required':
      return new FormEngineError({ ...base, code: 'provider_reauthorization_required', message: 'Your Typeform authorization has expired or was revoked. Reconnect Typeform, then try again.', retryable: false });
    case 'not_configured':
      return new FormEngineError({ ...base, code: 'provider_not_configured', message: 'Typeform is not set up on this Intake server yet.', retryable: false });
    case 'provider_unavailable':
      return new FormEngineError({ ...base, code: 'provider_unavailable', message: 'Typeform could not be reached to renew your authorization. Try again in a moment.', retryable: true });
    case 'storage_unavailable':
      return new FormEngineError({ ...base, code: 'storage_unavailable', message: 'Intake could not read your Typeform connection right now. Try again in a moment.', retryable: true });
    default:
      return new FormEngineError({ ...base, code: 'unsupported_provider', message: 'That provider is not supported.', retryable: false });
  }
}

interface FailureContext {
  stage: BuildStage;
  operation: TypeformOperation;
  formId: string | null;
  requestId: string;
  log: FormLogger;
  userId: string;
  connection: ConnectedTypeform;
  reportRejected: NonNullable<TypeformProviderDeps['reportAuthorizationRejected']>;
}

async function failure(error: unknown, context: FailureContext): Promise<FormEngineError> {
  const { stage, formId } = context;
  const api = error instanceof TypeformApiError ? error.info : null;
  const outcome = outcomeFor(api, stage, formId);
  const partialForm = formId ? { providerFormId: formId, editUrl: editUrl(formId), state: 'unpublished' as const } : undefined;

  const info = api ? describeApiFailure(api, stage) : { code: 'internal_error' as const, reason: 'Something unexpected went wrong inside Intake.', retryable: false };
  if (!api) logSafe('Typeform form creation failed unexpectedly', error);

  if (api?.kind === 'http' && api.httpStatus === 401) {
    try { await context.reportRejected(context.userId, 'typeform'); } catch { }
  }

  context.log('form.create.provider_failed', {
    requestId: context.requestId,
    provider: 'typeform',
    operation: context.operation,
    stage,
    formId,
    kind: api?.kind ?? 'internal',
    httpStatus: api?.httpStatus,
    typeformCode: api?.typeformCode,
    typeformDescription: api?.typeformDescription,
    typeformField: api?.typeformField,
    reason: info.reason,
    outcome,
    code: info.code,
  });

  const message = `${STAGE_FAILED[stage]} ${info.reason}${outcomeText(outcome)}`;
  const failureInfo: FormErrorInfo = {
    code: info.code,
    message,
    provider: 'typeform',
    stage,
    outcome,
    retryable: info.retryable && outcome === 'not_created',
  };
  if (info.retryAfterSeconds && failureInfo.retryable) failureInfo.retryAfterSeconds = info.retryAfterSeconds;
  if (partialForm) failureInfo.partialForm = partialForm;
  return new FormEngineError(failureInfo, { externalAccountId: context.connection.externalAccountId });
}

function outcomeFor(api: TypeformApiError['info'] | null, stage: BuildStage, formId: string | null): FormEngineError['info']['outcome'] {
  if (formId) return 'partial';
  if (stage !== 'create') return 'not_created';
  if (!api) return 'unknown';
  if (api.kind === 'http') return (api.httpStatus ?? 500) >= 500 ? 'unknown' : 'not_created';
  return 'unknown';
}

function outcomeText(outcome: FormEngineError['info']['outcome']): string {
  if (outcome === 'not_created') return ' Nothing was created.';
  if (outcome === 'unknown') return ' Typeform did not confirm the request, so a form may or may not exist. Check Typeform before trying again.';
  return ' A partly built form exists in your Typeform account and is not published. Open it to finish or delete it.';
}

function describeApiFailure(api: TypeformApiError['info'], _stage: BuildStage): { code: FormErrorInfo['code']; reason: string; retryable: boolean; retryAfterSeconds?: number } {
  if (api.kind === 'timeout' || api.kind === 'network') {
    return { code: 'provider_unavailable', reason: api.kind === 'timeout' ? 'Typeform took too long to answer.' : 'Typeform could not be reached.', retryable: true };
  }
  if (api.kind === 'malformed_response') {
    return { code: 'provider_error', reason: 'Typeform answered in a way Intake could not use.', retryable: false };
  }
  const status = api.httpStatus ?? 0;
  if (status === 401) {
    return { code: 'provider_reauthorization_required', reason: 'Typeform no longer accepts Intake\'s authorization. Reconnect Typeform, then try again.', retryable: false };
  }
  if (status === 403) {
    return { code: 'provider_permission_denied', reason: 'Typeform refused permission to create forms in this account.', retryable: false };
  }
  if (status === 404) {
    return { code: 'provider_rejected', reason: 'Typeform could not find the form.', retryable: false };
  }
  if (status === 429) {
    return { code: 'provider_rate_limited', reason: 'Typeform is limiting requests right now. Wait a moment and try again.', retryable: true, ...(api.retryAfterSeconds ? { retryAfterSeconds: api.retryAfterSeconds } : {}) };
  }
  if (status >= 500) {
    return { code: 'provider_error', reason: 'Typeform had a temporary problem.', retryable: true };
  }
  return { code: 'provider_rejected', reason: 'Typeform rejected the request.', retryable: false };
}

function mapTypeformReadError(api: TypeformApiError['info']): FormErrorInfo['code'] {
  if (api.kind === 'timeout' || api.kind === 'network') return 'provider_unavailable';
  if (api.kind === 'malformed_response') return 'provider_error';
  const status = api.httpStatus ?? 0;
  if (status === 401) return 'provider_reauthorization_required';
  if (status === 403) return 'provider_permission_denied';
  if (status === 404) return 'provider_rejected';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_error';
  return 'provider_rejected';
}

function mapTypeformErrorMessage(api: TypeformApiError['info']): string {
  if (api.kind === 'timeout') return 'Typeform took too long to answer.';
  if (api.kind === 'network') return 'Typeform could not be reached.';
  if (api.kind === 'malformed_response') return 'Typeform answered in a way Intake could not use.';
  const status = api.httpStatus ?? 0;
  if (status === 401) return 'Typeform no longer accepts Intake\'s authorization. Reconnect Typeform, then try again.';
  if (status === 403) return 'Typeform refused permission.';
  if (status === 404) return 'Typeform could not find the form.';
  if (status === 429) return 'Typeform is limiting requests right now.';
  if (status >= 500) return 'Typeform had a temporary problem.';
  return 'Typeform rejected the request.';
}

/** A missing or rejected connection is a clean, unapplied failure — never an unknown outcome. */
function editConnectionFailure(error: unknown): FormEditError {
  if (error instanceof FormEditError) return error;
  if (error instanceof FormEngineError) {
    const known: FormEditErrorCode[] = ['provider_not_connected', 'provider_not_configured', 'provider_reauthorization_required', 'provider_permission_denied', 'storage_unavailable'];
    return new FormEditError({
      code: known.includes(error.info.code as FormEditErrorCode) ? error.info.code as FormEditErrorCode : 'provider_unavailable',
      message: error.info.message.replace('Nothing was created.', 'Nothing was changed.'),
      outcome: 'not_applied',
      retryable: error.info.retryable,
    });
  }
  return new FormEditError({ code: 'internal_error', message: 'Intake could not verify your Typeform connection. The form was not changed.', outcome: 'not_applied', retryable: true });
}

/** Maps a Typeform transport failure onto the edit taxonomy, without leaking provider detail. */
function typeformEditFailure(error: unknown, message: string): FormEditError {
  if (error instanceof FormEditError) return error;
  const api = error instanceof TypeformApiError ? error.info : null;
  if (!api) return new FormEditError({ code: 'internal_error', message, outcome: 'not_applied', retryable: false });
  const retryable = api.kind === 'timeout' || api.kind === 'network' || (api.kind === 'http' && (api.httpStatus ?? 0) >= 500);
  return new FormEditError({ code: typeformEditCode(api), message: `${mapTypeformErrorMessage(api)} ${message}`.trim(), outcome: 'not_applied', retryable });
}

/** The edit taxonomy is narrower than the create one; map explicitly instead of casting. */
function typeformEditCode(api: TypeformApiErrorInfo): FormEditErrorCode {
  if (api.kind === 'timeout' || api.kind === 'network') return 'provider_unavailable';
  if (api.kind === 'malformed_response') return 'provider_error';
  const status = api.httpStatus ?? 0;
  if (status === 401) return 'provider_reauthorization_required';
  if (status === 403) return 'provider_permission_denied';
  if (status === 404) return 'form_not_found';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
}

function editUrl(formId: string): string {
  return `https://admin.typeform.com/form/${encodeURIComponent(formId)}/edit`;
}
