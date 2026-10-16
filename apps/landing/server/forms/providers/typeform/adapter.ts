import { safeFormUrl } from '../../../../src/lib/forms';
import { hasScope, logSafe } from '../../../providers/oauth';
import { getProviderConnection, reportProviderAuthorizationRejected, type AuthorizedConnection } from '../../../providers/service';
import { FormEngineError, type FormErrorInfo } from '../../errors';
import { createFormLogger, newRequestId, type FormLogger } from '../../logging';
import { TypeformApiError, createTypeformClient, type TypeformClient, type TypeformOperation, type TypeformFormResource } from './client';
import { planTypeform } from './plan';
import type { CreatedForm, FormsProvider } from '../../provider';
import type { FormSpecification } from '../../specification';
import { ensureValidatedSpecification } from '../../validation';

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
    capabilities: { createForm: true, editForm: false },

    async retrieveForm(userId: string, providerFormId: string, context?: { requestId?: string; log?: FormLogger }) {
      const requestId = context?.requestId ?? newRequestId();
      const log = context?.log ?? fallbackLog;
      if (!isTypeformId(providerFormId)) throw new FormEngineError({ code: 'invalid_request', message: 'That Typeform URL does not contain a valid form ID.', provider: 'typeform', outcome: 'not_created', retryable: false });
      const connection = await acquireConnection(getConnection, userId);
      try {
        log('form.create.provider_request', { requestId, userId, provider: 'typeform', operation: 'forms.get', formId: providerFormId, stage: 'retrieve' });
        const resource = await client.getForm(connection.accessToken, providerFormId);
        return { current: typeformFormSnapshot(resource), externalAccountId: connection.externalAccountId };
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
        const created = await client.createForm(token, { title: plan.title, fields: plan.fields, settings: plan.settings, theme: plan.theme, welcomeScreens: plan.welcomeScreens, thankYouScreens: plan.thankYouScreens, logic: plan.logic });
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

function editUrl(formId: string): string {
  return `https://admin.typeform.com/form/${encodeURIComponent(formId)}/edit`;
}

function typeformFormSnapshot(resource: TypeformFormResource): any {
  return {
    providerFormId: resource.id,
    revisionId: resource.updatedAt,
    title: resource.title,
    editUrl: editUrl(resource.id),
    responderUrl: safeFormUrl(resource._links?.display),
    items: resource.fields.map((field, index) => ({
      itemId: field.ref ?? field.id ?? `field_${index}`,
      questionId: field.ref ?? field.id,
      index,
      sectionIndex: 0,
      kind: 'question',
      title: field.title,
      description: field.properties?.description as string | undefined,
      questionType: field.type as string,
      required: field.validations?.required === true,
      options: ((field.properties?.choices as Array<{ label: string }> | undefined) ?? []).map(c => c.label),
      hasRouting: false,
      capabilities: ['update_title', 'update_description', 'update_required'],
    })),
    hasSections: false,
    hasBranching: resource.logic.length > 0,
    isQuiz: false,
  };
}