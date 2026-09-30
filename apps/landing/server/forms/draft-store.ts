import type { FormWarning, CreateFormResult } from '../../src/lib/forms';
import type { FormSpecification } from './specification';

export type DraftStatus = 'ready' | 'creating' | 'created' | 'blocked';

/** A draft holds the current specification, not a chat transcript or any OAuth credentials. */
export interface DraftRecord {
  id: string;
  userId: string;
  provider: 'google';
  version: number;
  status: DraftStatus;
  specification: FormSpecification;
  assumptions: string[];
  warnings: FormWarning[];
  /** One attempted creation's public outcome. A blocked attempt is never sent to Google again. */
  result: CreateFormResult | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDraft = Pick<DraftRecord, 'id' | 'userId' | 'provider' | 'specification' | 'assumptions' | 'warnings'>;

/** All reads and compare-and-swap writes are scoped by the Intake session's user id. */
export interface DraftStore {
  create(input: NewDraft, now: Date): Promise<DraftRecord>;
  get(userId: string, id: string): Promise<DraftRecord | null>;
  /** A revision cannot overwrite a newer revision or a draft already claimed for creation. */
  revise(userId: string, id: string, version: number, changes: Pick<NewDraft, 'specification' | 'assumptions' | 'warnings'>, now: Date): Promise<DraftRecord | null>;
  /** Atomic claim: only one request (including across API processes) may reach the provider per draft. */
  claim(userId: string, id: string, version: number, now: Date): Promise<DraftRecord | null>;
  /** The claim stays locked if this write fails. An ambiguous operation is never retried automatically. */
  finish(userId: string, id: string, status: Extract<DraftStatus, 'ready' | 'created' | 'blocked'>, result: CreateFormResult, now: Date): Promise<boolean>;
  discard(userId: string, id: string): Promise<boolean>;
}
