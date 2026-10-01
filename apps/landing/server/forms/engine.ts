import { randomUUID } from 'node:crypto';
import { isProviderId, type ProviderId } from '../../src/lib/connections';
import type { FormWarning, PublicCreatedForm, PublicFormSummary, PublicLibraryForm } from '../../src/lib/forms';
import { logSafe } from '../providers/oauth';
import { isMissingTable } from '../providers/service';
import { FormEngineError, type FormErrorInfo } from './errors';
import { FormEditError } from './edit-errors';
import { extractGoogleFormId } from './edit-engine';
import { createFormLogger, newRequestId, type FormLogger } from './logging';
import type { CreatedForm, FormsProviders } from './provider';
import { SPEC_VERSION, type FormSpecification } from './specification';
import type { FormLibraryFilter, FormLibraryRecord, FormRecord, FormStore, FormSummaryRecord, IncompleteStage, NewFormRecord } from './store';
import { parseFormSpecification } from './validation';

const LIST_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 12;

export interface CreationLimiter {
  acquire(userId: string, now: number): { ok: true; release(): void } | { ok: false; reason: 'in_progress' | 'rate_limited' };
}

/**
 * One creation at a time per user, and a ceiling per window. Both protect the user's Google quota
 * and stop a double click or a runaway client from creating duplicates. In memory: it resets on
 * restart and is per process, which is enough for a single API instance.
 */
export function createCreationLimiter(options: { limit?: number; windowMs?: number } = {}): CreationLimiter {
  const limit = options.limit ?? RATE_LIMIT;
  const windowMs = options.windowMs ?? RATE_WINDOW_MS;
  const hits = new Map<string, number[]>();
  const running = new Set<string>();
  return {
    acquire(userId, now) {
      if (running.has(userId)) return { ok: false, reason: 'in_progress' };
      const recent = (hits.get(userId) ?? []).filter(time => now - time < windowMs);
      if (recent.length >= limit) {
        hits.set(userId, recent);
        return { ok: false, reason: 'rate_limited' };
      }
      recent.push(now);
      hits.set(userId, recent);
      running.add(userId);
      return { ok: true, release: () => void running.delete(userId) };
    },
  };
}

export interface FormEngineDeps {
  providers: FormsProviders;
  store: FormStore;
  log?: FormLogger;
  now?: () => Date;
  limiter?: CreationLimiter;
  newId?: () => string;
}

export type CreateFormOutcome =
  | { ok: true; requestId: string; form: PublicCreatedForm; warnings: FormWarning[] }
  | { ok: false; requestId: string; error: FormErrorInfo };

export type ListFormsOutcome = { ok: true; forms: PublicFormSummary[] } | { ok: false; error: FormErrorInfo };

export type ListLibraryOutcome = { ok: true; forms: PublicLibraryForm[] } | { ok: false; error: FormErrorInfo };

export type GetFormOutcome = { ok: true; form: PublicLibraryForm } | { ok: false; error: FormErrorInfo };

export type RefreshFormStatus = 'accessible' | 'reconnection_required' | 'inaccessible' | 'missing' | 'unavailable' | 'unknown';

export type RefreshFormOutcome =
  | { ok: true; status: 'accessible'; form: PublicLibraryForm }
  | { ok: false; status: RefreshFormStatus; error: string; form?: PublicLibraryForm };

export type ArchiveFormOutcome = { ok: true; archived: boolean } | { ok: false; error: FormErrorInfo };

export type RemoveFormOutcome = { ok: true; removed: boolean; message: string } | { ok: false; error: FormErrorInfo };

export type ImportFormOutcome =
  | { ok: true; form: PublicLibraryForm; alreadyExists: boolean }
  | { ok: false; error: FormErrorInfo };

export interface FormEngine {
  createForm(input: { userId: string; provider: unknown; specification: unknown; requestId?: string }): Promise<CreateFormOutcome>;
  listForms(userId: string): Promise<ListFormsOutcome>;
  listLibrary(userId: string, filter?: FormLibraryFilter): Promise<ListLibraryOutcome>;
  getForm(userId: string, id: string): Promise<GetFormOutcome>;
  refreshForm(userId: string, id: string, requestId?: string): Promise<RefreshFormOutcome>;
  archiveForm(userId: string, id: string, archived: boolean): Promise<ArchiveFormOutcome>;
  removeForm(userId: string, id: string): Promise<RemoveFormOutcome>;
  importForm(userId: string, url: string, requestId?: string): Promise<ImportFormOutcome>;
}

export function createFormEngine(deps: FormEngineDeps): FormEngine {
  const log = deps.log ?? createFormLogger();
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? createCreationLimiter();
  const newId = deps.newId ?? randomUUID;

  return {
    async createForm(input) {
      const requestId = input.requestId ?? newRequestId();
      const { userId } = input;
      const startedAt = performance.now();
      const providerLabel = typeof input.provider === 'string' ? input.provider.slice(0, 24) : 'invalid';
      log('form.create.started', { requestId, userId, provider: providerLabel });

      const reject = (error: FormErrorInfo, reason: string): CreateFormOutcome => {
        log('form.create.rejected', { requestId, userId, provider: providerLabel, reason, code: error.code });
        return { ok: false, requestId, error };
      };

      // 1. Which provider? An unknown value never reaches an adapter.
      const provider = typeof input.provider === 'string' && isProviderId(input.provider) ? input.provider : null;
      if (!provider) {
        return reject({ code: 'unsupported_provider', message: 'That provider is not supported. Use "google".', outcome: 'not_created', retryable: false }, 'unsupported_provider');
      }

      // 2. Provider-independent validation. Pure: no request of any kind has been made yet.
      const parsed = parseFormSpecification(input.specification);
      if (!parsed.ok) {
        log('form.create.validation_failed', { requestId, userId, provider, issueCount: parsed.issues.length, codes: [...new Set(parsed.issues.map(issue => issue.code))] });
        return {
          ok: false,
          requestId,
          error: { code: 'validation_failed', message: 'The form specification is not valid. Nothing was created.', issues: parsed.issues, provider, outcome: 'not_created', retryable: false },
        };
      }
      const specification = parsed.specification;

      // 3. Can this provider create forms at all?
      const adapter = deps.providers[provider];
      if (!adapter.capabilities.createForm) {
        return reject(
          { code: 'provider_not_supported', message: adapter.capabilities.note ?? 'This provider cannot create forms yet.', provider, outcome: 'not_created', retryable: false },
          'provider_not_supported',
        );
      }

      // 4. One at a time, within a ceiling.
      const slot = limiter.acquire(userId, now().getTime());
      if (!slot.ok) {
        return reject(
          slot.reason === 'in_progress'
            ? { code: 'creation_in_progress', message: 'A form is already being created for your account. Wait for it to finish.', provider, outcome: 'not_created', retryable: true }
            : { code: 'rate_limited', message: 'Too many forms were created in a short time. Wait a few minutes and try again.', provider, outcome: 'not_created', retryable: true },
          slot.reason,
        );
      }

      try {
        // 5. The adapter validates again, checks provider limits, fetches this user's connection and builds the form.
        const created = await adapter.createForm(userId, specification, { requestId, log });
        const record = await save(deps.store, log, now, newId, {
          requestId,
          userId,
          created,
          specification,
          status: 'created',
          failureStage: null,
        });
        log('form.create.completed', {
          requestId,
          userId,
          provider,
          formId: created.providerFormId,
          questionCount: specification.questions.length,
          published: created.published,
          recorded: record !== null,
          warningCount: created.warnings.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return {
          ok: true,
          requestId,
          form: publicForm(created, record?.id ?? null, record?.createdAt ?? null),
          warnings: created.warnings,
        };
      } catch (error) {
        if (error instanceof FormEngineError) {
          const info = error.info;
          if (info.code === 'unsupported_by_provider') {
            log('form.create.validation_failed', { requestId, userId, provider, kind: 'provider_capability', issueCount: info.issues?.length ?? 0, codes: [...new Set((info.issues ?? []).map(issue => issue.code))] });
          }
          // A form that exists in the provider account but was not finished is recorded, so it can be found and finished or deleted.
          if (info.partialForm && info.stage && isIncompleteStage(info.stage) && error.externalAccountId) {
            await save(deps.store, log, now, newId, {
              requestId,
              userId,
              created: {
                provider,
                providerFormId: info.partialForm.providerFormId,
                title: specification.title,
                ...(info.partialForm.editUrl ? { editUrl: info.partialForm.editUrl } : {}),
                published: false,
                warnings: [],
                externalAccountId: error.externalAccountId,
              },
              specification,
              status: 'incomplete',
              failureStage: info.stage,
            });
          }
          return { ok: false, requestId, error: info };
        }
        logSafe('Form creation failed unexpectedly', error);
        log('form.create.provider_failed', { requestId, userId, provider, kind: 'internal', durationMs: Math.round(performance.now() - startedAt) });
        return { ok: false, requestId, error: { code: 'internal_error', message: 'Something went wrong inside Intake. Use the request id if you need help. The form may not have been created.', provider, retryable: false } };
      } finally {
        slot.release();
      }
    },

    async listForms(userId) {
      try {
        const rows = await deps.store.listForUser(userId, LIST_LIMIT);
        return { ok: true, forms: rows.map(publicSummary) };
      } catch (error) {
        logSafe('Listing forms failed', error);
        return { ok: false, error: { code: 'storage_unavailable', message: 'Intake could not load your forms right now. Try again in a moment.', retryable: true } };
      }
    },

    async listLibrary(userId, filter = {}) {
      try {
        const rows = await deps.store.listLibrary(userId, filter);
        return { ok: true, forms: rows.map(publicLibrary) };
      } catch (error) {
        logSafe('Listing library forms failed', error);
        return { ok: false, error: { code: 'storage_unavailable', message: 'Intake could not load your form library right now. Try again in a moment.', retryable: true } };
      }
    },

    async getForm(userId, id) {
      try {
        const record = await deps.store.getForUser(userId, id);
        if (!record) {
          return { ok: false, error: { code: 'invalid_request', message: 'That form is not available in your Intake account.', retryable: false } };
        }
        return { ok: true, form: publicLibrary(record) };
      } catch (error) {
        logSafe('Retrieving form failed', error);
        return { ok: false, error: { code: 'storage_unavailable', message: 'Intake could not load the form details right now. Try again in a moment.', retryable: true } };
      }
    },

    async refreshForm(userId, id, requestId = newRequestId()) {
      let existing: FormRecord | null = null;
      try {
        existing = await deps.store.getForUser(userId, id);
      } catch (error) {
        logSafe('Looking up form before refresh failed', error);
        return { ok: false, status: 'unavailable', error: 'Intake storage is temporarily unavailable.' };
      }
      if (!existing) {
        return { ok: false, status: 'missing', error: 'Form not found in your Intake account.' };
      }

      if (existing.provider !== 'google') {
        return { ok: false, status: 'unknown', error: 'Live status verification is only available for Google Forms.', form: publicLibrary(existing) };
      }

      const adapter = deps.providers.google;
      if (!adapter?.retrieveForm) {
        return { ok: false, status: 'unavailable', error: 'Google Forms provider cannot retrieve form state.', form: publicLibrary(existing) };
      }

      try {
        log('form.library.refresh_started', { requestId, userId, formId: existing.providerFormId, recordId: id });
        const loaded = await adapter.retrieveForm(userId, existing.providerFormId, { requestId, log });
        const currentTitle = loaded.current.title || existing.title;
        const currentDescription = loaded.current.description ?? existing.description;
        const currentEdit = loaded.current.editUrl || existing.editUrl;
        const currentResponder = loaded.current.responderUrl ?? existing.responderUrl;

        await deps.store.touchSync(userId, id, {
          title: currentTitle,
          description: currentDescription,
          editUrl: currentEdit ?? null,
          responderUrl: currentResponder,
        }, now());

        const refreshed = await deps.store.getForUser(userId, id);
        log('form.library.refresh_completed', { requestId, userId, formId: existing.providerFormId, recordId: id, status: 'accessible' });
        return { ok: true, status: 'accessible', form: publicLibrary(refreshed ?? existing) };
      } catch (error) {
        logSafe('Live form status check failed', error);
        const code = error instanceof FormEditError ? error.info.code : error instanceof FormEngineError ? error.info.code : undefined;
        let status: RefreshFormStatus = 'unknown';
        let message = 'Could not verify the current form status with Google Forms.';

        if (code === 'form_not_found') {
          status = 'missing';
          message = 'Google Forms could not find this form. It may have been deleted or moved in your Google account.';
        } else if (code === 'form_not_editable' || code === 'provider_permission_denied') {
          status = 'inaccessible';
          message = 'Your connected Google account does not have permission to access or edit this form.';
        } else if (code === 'provider_not_connected' || code === 'provider_reauthorization_required') {
          status = 'reconnection_required';
          message = 'Google account reconnection required. Reconnect Google to verify form access.';
        } else if (code === 'provider_unavailable' || code === 'provider_rate_limited') {
          status = 'unavailable';
          message = 'Google Forms is temporarily unreachable. Your Intake record is preserved.';
        }

        log('form.library.refresh_failed', { requestId, userId, formId: existing.providerFormId, recordId: id, status, code });
        return { ok: false, status, error: message, form: publicLibrary(existing) };
      }
    },

    async archiveForm(userId, id, archived) {
      try {
        const existing = await deps.store.getForUser(userId, id);
        if (!existing) {
          return { ok: false, error: { code: 'invalid_request', message: 'That form is not available in your Intake account.', retryable: false } };
        }
        await deps.store.archive(userId, id, archived, now());
        return { ok: true, archived };
      } catch (error) {
        logSafe('Archiving form failed', error);
        return { ok: false, error: { code: 'storage_unavailable', message: 'Intake could not update the archive status right now.', retryable: true } };
      }
    },

    async removeForm(userId, id) {
      try {
        const existing = await deps.store.getForUser(userId, id);
        if (!existing) {
          return { ok: false, error: { code: 'invalid_request', message: 'That form is not available in your Intake account.', retryable: false } };
        }
        await deps.store.remove(userId, id);
        return { ok: true, removed: true, message: 'Form removed from your Intake library. The form remains in your Google account.' };
      } catch (error) {
        logSafe('Removing form from library failed', error);
        return { ok: false, error: { code: 'storage_unavailable', message: 'Intake could not remove the form reference right now.', retryable: true } };
      }
    },

    async importForm(userId, url, requestId = newRequestId()) {
      const formId = extractGoogleFormId(url);
      if (!formId) {
        return {
          ok: false,
          error: {
            code: 'invalid_request',
            message: 'Provide a valid Google Forms edit URL (e.g. https://docs.google.com/forms/d/FORM_ID/edit). Short links and invalid URLs are rejected.',
            retryable: false,
          },
        };
      }

      try {
        const existing = await deps.store.getByProviderFormId(userId, 'google', formId);
        if (existing) {
          return { ok: true, form: publicLibrary(existing), alreadyExists: true };
        }

        const adapter = deps.providers.google;
        if (!adapter?.retrieveForm) {
          return { ok: false, error: { code: 'provider_not_supported', message: 'Google Forms provider cannot retrieve forms.', retryable: false } };
        }

        log('form.library.import_started', { requestId, userId, formId });
        const loaded = await adapter.retrieveForm(userId, formId, { requestId, log });

        const record: NewFormRecord = {
          id: newId(),
          userId,
          provider: 'google',
          externalAccountId: loaded.externalAccountId,
          providerFormId: loaded.current.providerFormId,
          title: loaded.current.title || 'Untitled Google Form',
          description: loaded.current.description ?? null,
          status: 'created',
          editUrl: loaded.current.editUrl,
          responderUrl: loaded.current.responderUrl ?? null,
          failureStage: null,
          requestId,
          specification: null,
          specificationVersion: SPEC_VERSION,
          source: 'imported',
          lastSyncedAt: now(),
          archivedAt: null,
        };

        const saved = await deps.store.save(record, now());
        log('form.library.import_completed', { requestId, userId, formId, recordId: saved.id });
        return { ok: true, form: publicLibrary(saved), alreadyExists: false };
      } catch (error) {
        logSafe('Importing Google Form failed', error);
        log('form.library.import_failed', { requestId, userId, formId });
        if (error instanceof FormEditError || error instanceof FormEngineError) {
          const code = error.info.code;
          const mappedCode =
            code === 'form_not_found' || code === 'form_not_editable' || code === 'invalid_form_url' || code === 'edit_unsupported' || code === 'edit_draft_conflict' || code === 'edit_draft_locked' || code === 'edit_draft_not_found' || code === 'edit_plan_invalid' || code === 'edit_stale'
              ? 'invalid_request'
              : code;
          return { ok: false, error: { code: mappedCode as FormErrorInfo['code'], message: error.info.message, retryable: error.info.retryable } };
        }
        return { ok: false, error: { code: 'internal_error', message: 'Intake could not import this Google Form. Check your connection and try again.', retryable: false } };
      }
    },
  };
}

function isIncompleteStage(stage: string): stage is IncompleteStage {
  return stage === 'add_questions' || stage === 'configure_logic' || stage === 'publish';
}

async function save(
  store: FormStore,
  log: FormLogger,
  now: () => Date,
  newId: () => string,
  input: { requestId: string; userId: string; created: CreatedForm; specification: FormSpecification; status: 'created' | 'incomplete'; failureStage: IncompleteStage | null },
) {
  const { created } = input;
  const record: NewFormRecord = {
    id: newId(),
    userId: input.userId,
    provider: created.provider,
    externalAccountId: created.externalAccountId,
    providerFormId: created.providerFormId,
    title: created.title,
    description: input.specification.description ?? null,
    source: 'created',
    lastSyncedAt: now(),
    archivedAt: null,
    status: input.status,
    editUrl: created.editUrl ?? null,
    responderUrl: input.status === 'created' ? (created.responderUrl ?? null) : null,
    failureStage: input.failureStage,
    requestId: input.requestId,
    specification: input.specification,
    specificationVersion: SPEC_VERSION,
  };
  try {
    return await store.save(record, now());
  } catch (error) {
    // The form exists in the provider account either way. Failing to write our copy must not turn a
    // successful creation into an error, so the id is logged where an operator can recover it.
    logSafe('Saving the form record failed', error);
    log('form.create.persist_failed', {
      requestId: input.requestId,
      userId: input.userId,
      provider: created.provider,
      formId: created.providerFormId,
      status: input.status,
      reason: isMissingTable(error) ? 'storage_unavailable' : 'storage_failed',
    });
    return null;
  }
}

/** The only place a CreatedForm becomes something the browser sees. Fields are copied, not spread. */
function publicForm(created: CreatedForm, id: string | null, createdAt: Date | null): PublicCreatedForm {
  return {
    id,
    provider: created.provider as ProviderId,
    providerFormId: created.providerFormId,
    title: created.title,
    editUrl: created.editUrl ?? null,
    responderUrl: created.responderUrl ?? null,
    published: created.published,
    createdAt: createdAt ? createdAt.toISOString() : null,
  };
}

function publicSummary(row: FormSummaryRecord): PublicFormSummary {
  return {
    id: row.id,
    provider: row.provider,
    providerFormId: row.providerFormId,
    title: row.title,
    status: row.status,
    failureStage: row.failureStage,
    editUrl: row.editUrl,
    responderUrl: row.responderUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

function publicLibrary(row: FormLibraryRecord | FormRecord): PublicLibraryForm {
  return {
    id: row.id,
    provider: row.provider,
    providerFormId: row.providerFormId,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    failureStage: row.failureStage,
    editUrl: row.editUrl,
    responderUrl: row.responderUrl,
    source: row.source ?? 'created',
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
