import type { ProviderId } from '../../src/lib/connections';
import type { FormStage } from '../../src/lib/forms';
import type { FormSpecification } from './specification';

export type FormStatus = 'created' | 'incomplete';

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
  status: FormStatus;
  editUrl: string | null;
  /** Always null for an incomplete form: it does not accept responses. */
  responderUrl: string | null;
  failureStage: IncompleteStage | null;
  requestId: string;
  specification: FormSpecification;
  specificationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewFormRecord = Omit<FormRecord, 'createdAt' | 'updatedAt'>;

/** What a list needs. No specification, no account id, no request id. */
export type FormSummaryRecord = Pick<FormRecord, 'id' | 'provider' | 'providerFormId' | 'title' | 'status' | 'failureStage' | 'editUrl' | 'responderUrl' | 'createdAt'>;

/**
 * Every operation is scoped by the Intake user id, which comes from the server session and never from
 * the request body. There is deliberately no way to read another user's forms.
 */
export interface FormStore {
  save(input: NewFormRecord, now: Date): Promise<FormRecord>;
  listForUser(userId: string, limit: number): Promise<FormSummaryRecord[]>;
}
