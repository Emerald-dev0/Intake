import type { FormEditPlan, FormEditResult, FormEditSnapshot } from '../../src/lib/form-edit';

export type StoredEditStatus = 'ready' | 'applying' | 'applied' | 'blocked' | 'stale';

/** A server-owned edit proposal. It contains a normalized form snapshot, never the raw Forms response or a credential. */
export interface FormEditDraftRecord {
  id: string;
  userId: string;
  provider: 'google';
  version: number;
  status: StoredEditStatus;
  providerFormId: string;
  formRecordId: string | null;
  externalAccountId: string;
  current: FormEditSnapshot;
  plan: FormEditPlan;
  result: FormEditResult | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewFormEditDraft = Pick<FormEditDraftRecord, 'id' | 'userId' | 'provider' | 'providerFormId' | 'formRecordId' | 'externalAccountId' | 'current' | 'plan'>;

export interface FormEditDraftStore {
  create(input: NewFormEditDraft, now: Date): Promise<FormEditDraftRecord>;
  get(userId: string, id: string): Promise<FormEditDraftRecord | null>;
  revise(userId: string, id: string, version: number, plan: FormEditPlan, now: Date): Promise<FormEditDraftRecord | null>;
  claim(userId: string, id: string, version: number, now: Date): Promise<FormEditDraftRecord | null>;
  markStale(userId: string, id: string, version: number, result: FormEditResult, now: Date): Promise<boolean>;
  finish(userId: string, id: string, status: StoredEditStatus, result: FormEditResult, now: Date, current?: FormEditSnapshot): Promise<boolean>;
  discard(userId: string, id: string): Promise<boolean>;
}
