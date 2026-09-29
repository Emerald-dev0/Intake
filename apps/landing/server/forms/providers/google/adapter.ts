import { safeFormUrl, type FormOutcome, type FormStage, type PartialForm } from '../../../../src/lib/forms';
import { hasScope, logSafe } from '../../../providers/oauth';
import { getProviderConnection, reportProviderAuthorizationRejected, type AuthorizedConnection } from '../../../providers/service';
import { FormEngineError, type FormErrorInfo } from '../../errors';
import { createFormLogger, newRequestId, type FormLogger } from '../../logging';
import type { CreatedForm, FormsProvider } from '../../provider';
import type { FormSpecification } from '../../specification';
import { ensureValidatedSpecification } from '../../validation';
import { createGoogleFormsClient, createdItemId, GoogleFormsApiError, type GoogleFormsClient, type GoogleFormsOperation } from './client';
import { buildInitialBatch, buildRoutingBatch, countQuestions, hasDeferredRouting, planGoogleForm } from './plan';

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
    capabilities: { createForm: true },

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

function request(log: FormLogger, requestId: string, operation: GoogleFormsOperation, stage: BuildStage, formId: string | null, extra: Record<string, number>): void {
  log('form.create.provider_request', { requestId, provider: 'google', operation, stage, formId, ...extra });
}

export function editUrl(formId: string): string {
  return `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/edit`;
}

async function acquireConnection(getConnection: NonNullable<GoogleFormsProviderDeps['getConnection']>, userId: string): Promise<ConnectedGoogle> {
  let result: AuthorizedConnection;
  try {
    result = await getConnection(userId, 'google');
  } catch (error) {
    logSafe('Forms connection lookup failed', error);
    throw new FormEngineError({
      code: 'storage_unavailable',
      message: 'Intake could not read your Google connection right now. Nothing was created. Try again in a moment.',
      provider: 'google',
      stage: 'connection',
      outcome: 'not_created',
      retryable: true,
    });
  }
  if (!result.ok) throw connectionError(result.reason);
  // The service already scopes by user. This is a second, independent check of the ownership chain.
  if (result.provider !== 'google' || result.userId !== userId) {
    logSafe('Forms connection ownership mismatch');
    throw new FormEngineError({ code: 'internal_error', message: 'Intake could not verify which Google connection to use. Nothing was created.', provider: 'google', stage: 'connection', outcome: 'not_created', retryable: false });
  }
  if (!hasScope(result.scopes, FORMS_BODY_SCOPE)) {
    throw connectionError('reauthorization_required');
  }
  return result;
}

type ConnectionFailure = Extract<AuthorizedConnection, { ok: false }>['reason'];

function connectionError(reason: ConnectionFailure): FormEngineError {
  const base = { provider: 'google' as const, stage: 'connection' as const, outcome: 'not_created' as const };
  switch (reason) {
    case 'not_connected':
      return new FormEngineError({ ...base, code: 'provider_not_connected', message: 'Google is not connected to your Intake account. Connect Google Forms first. Nothing was created.', retryable: false });
    case 'expired':
    case 'reauthorization_required':
      return new FormEngineError({ ...base, code: 'provider_reauthorization_required', message: 'Your Google authorization has expired or was revoked. Reconnect Google, then try again. Nothing was created.', retryable: false });
    case 'not_configured':
      return new FormEngineError({ ...base, code: 'provider_not_configured', message: 'Google is not set up on this Intake server yet, so it cannot create forms. Nothing was created.', retryable: false });
    case 'provider_unavailable':
      return new FormEngineError({ ...base, code: 'provider_unavailable', message: 'Google could not be reached to renew your authorization. Nothing was created. Try again in a moment.', retryable: true });
    case 'storage_unavailable':
      return new FormEngineError({ ...base, code: 'storage_unavailable', message: 'Intake could not read your Google connection right now. Nothing was created. Try again in a moment.', retryable: true });
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

function describeApiFailure(api: GoogleFormsApiError['info'], stage: BuildStage): { code: FormErrorInfo['code']; reason: string; retryable: boolean; detail?: string } {
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
    return { code: 'provider_rate_limited', reason: 'Google is limiting requests right now. Wait a minute and try again.', retryable: true };
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
