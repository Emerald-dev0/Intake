import type { ProviderId } from '../../src/lib/connections';
import type { FormStage } from '../../src/lib/forms';
import type { FormSpecification } from './specification';

export type FormStatus = 'created' | 'incomplete';
export type FormSource = 'created' | 'imported';

/** Stages at which a form can be left incomplete. `create` never leaves a form behind that Intake knows about. */
export type IncompleteStage = Extract<FormStage, 'add_questions' | 'configure_logic' | 'publish'>;

export interface FormRecord {
  id: string;
  userId: string;
  provider: ProviderId;
  /** The provider account the form lives in. Server-only. */
  externalAccountId: string;
  providerFormId: string;
  title: string;
  description: string | null;
  status: FormStatus;
  editUrl: string | null;
  /** Always null for an incomplete form: it does not accept responses. */
  responderUrl: string | null;
  failureStage: IncompleteStage | null;
  requestId: string;
  specification: FormSpecification | null;
  specificationVersion: number;
  source: FormSource;
  lastSyncedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewFormRecord = Omit<FormRecord, 'createdAt' | 'updatedAt'>;

/** What a basic list needs. No specification, no account id, no request id. */
export type FormSummaryRecord = Pick<FormRecord, 'id' | 'provider' | 'providerFormId' | 'title' | 'status' | 'failureStage' | 'editUrl' | 'responderUrl' | 'createdAt'>;

/** Rich library record for the Form Library workspace. */
export interface FormLibraryRecord extends FormSummaryRecord {
  description: string | null;
  source: FormSource;
  lastSyncedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface FormLibraryFilter {
  query?: string;
  provider?: ProviderId | 'all';
  source?: FormSource | 'all';
  archived?: boolean | 'all';
  sort?: 'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'updated' | 'synced';
  limit?: number;
}

/**
 * Every operation is scoped by the Intake user id, which comes from the server session and never from
 * the request body. There is deliberately no way to read another user's forms.
 */
export interface FormStore {
  save(input: NewFormRecord, now: Date): Promise<FormRecord>;
  listForUser(userId: string, limit: number): Promise<FormSummaryRecord[]>;
  listLibrary(userId: string, filter?: FormLibraryFilter): Promise<FormLibraryRecord[]>;
  getForUser(userId: string, id: string): Promise<FormRecord | null>;
  getByProviderFormId(userId: string, provider: ProviderId, providerFormId: string): Promise<FormRecord | null>;
  /** Update only safe, current display metadata after a provider-confirmed edit. */
  updateMetadata(input: { userId: string; id: string; providerFormId: string; externalAccountId: string; title: string; editUrl: string; responderUrl: string | null; description?: string | null }, now: Date): Promise<boolean>;
  archive(userId: string, id: string, archived: boolean, now: Date): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
  touchSync(userId: string, id: string, metadata: { title: string; description: string | null; editUrl: string | null; responderUrl: string | null }, now: Date): Promise<boolean>;
}
