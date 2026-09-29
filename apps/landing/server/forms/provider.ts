import type { ProviderId } from '../../src/lib/connections';
import type { FormWarning } from '../../src/lib/forms';
import { FormEngineError } from './errors';
import type { FormLogger } from './logging';
import type { FormSpecification } from './specification';

/**
 * What an adapter returns after creating a real form. Nothing here is a raw provider response:
 * adapters copy out the few fields Intake needs and drop the rest.
 */
export interface CreatedForm {
  provider: ProviderId;
  providerFormId: string;
  title: string;
  /** Where the owner edits the form. Built from the form id; not every provider returns one. */
  editUrl?: string;
  /** Where respondents fill it in. Only ever a URL the provider itself returned. */
  responderUrl?: string;
  published: boolean;
  warnings: FormWarning[];
  /**
   * The external account the form was created in. Server-only: it completes the ownership chain
   * (Intake user, provider connection, provider account, form) and is never sent to the browser.
   */
  externalAccountId: string;
}

export interface FormOperationContext {
  requestId: string;
  log: FormLogger;
}

export interface FormsProviderCapabilities {
  /** False means Intake cannot create forms with this provider, and says why in `note`. */
  createForm: boolean;
  note?: string;
}

/**
 * One implementation per external form platform. The engine, routes and future agent depend only on
 * this interface, so adding a provider never changes them.
 *
 * `createForm` validates the specification itself before doing anything else. A caller cannot cause
 * a provider request with an invalid specification by skipping validation.
 */
export interface FormsProvider {
  readonly id: ProviderId;
  readonly capabilities: FormsProviderCapabilities;
  createForm(userId: string, specification: FormSpecification, context?: FormOperationContext): Promise<CreatedForm>;
}

export type FormsProviders = Record<ProviderId, FormsProvider>;

/**
 * A provider that is connected but cannot create forms. It refuses explicitly and makes no network
 * request. Microsoft uses this until Microsoft publishes a supported Forms API.
 */
export function createPendingProvider(id: ProviderId, note: string): FormsProvider {
  return {
    id,
    capabilities: { createForm: false, note },
    async createForm() {
      throw new FormEngineError({ code: 'provider_not_supported', message: note, provider: id, outcome: 'not_created', retryable: false });
    },
  };
}
