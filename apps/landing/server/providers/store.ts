import type { ProviderId } from '../../src/lib/connections';

export type StoredStatus = 'connected' | 'expired' | 'reauthorization_required';

export interface OAuthTransaction {
  id: string;
  userId: string;
  provider: ProviderId;
  stateHash: string;
  codeVerifierCiphertext: string;
  nonceHash: string;
  redirectUri: string;
  /** Every scope this authorization asked for. What was actually granted is Google's answer, not this. */
  requestedScopes: string[];
  /** Where this person is sent once the authorization finishes. Null means the default page. */
  returnTo: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface NewTransaction {
  id: string;
  userId: string;
  provider: ProviderId;
  stateHash: string;
  codeVerifierCiphertext: string;
  nonceHash: string;
  redirectUri: string;
  requestedScopes: string[];
  returnTo: string | null;
  expiresAt: Date;
}

export interface ConnectionRecord {
  id: string;
  userId: string;
  provider: ProviderId;
  status: StoredStatus;
  externalAccountId: string;
  externalAccountEmail: string | null;
  externalAccountLabel: string | null;
  scopes: string[];
  accessTokenCiphertext: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenCiphertext: string | null;
  lastAuthorizedAt: Date | null;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionWrite {
  id: string;
  userId: string;
  provider: ProviderId;
  status: StoredStatus;
  externalAccountId: string;
  externalAccountEmail: string | null;
  externalAccountLabel: string | null;
  scopes: string[];
  accessTokenCiphertext: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenCiphertext: string | null;
  lastAuthorizedAt: Date;
  lastRefreshedAt: Date | null;
}

export interface ConnectionStore {
  createTransaction(input: NewTransaction, now: Date): Promise<void>;
  consumeTransaction(stateHash: string, userId: string, provider: ProviderId, now: Date): Promise<
    | { ok: true; transaction: OAuthTransaction }
    | { ok: false; reason: 'invalid_state' | 'expired_state' }
  >;
  getConnection(userId: string, provider: ProviderId): Promise<ConnectionRecord | null>;
  listConnections(userId: string): Promise<ConnectionRecord[]>;
  saveConnection(input: ConnectionWrite): Promise<{ ok: true; record: ConnectionRecord } | { ok: false; conflict: true }>;
  deleteConnection(userId: string, provider: ProviderId): Promise<boolean>;
  markNeedsReauthorization(userId: string, provider: ProviderId, status: StoredStatus, now: Date): Promise<void>;
  deleteTransactions(userId: string, provider: ProviderId): Promise<void>;
}

export function scopesToText(scopes: string[]): string {
  return scopes.join(' ');
}

export function textToScopes(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(' ').map(scope => scope.trim()).filter(Boolean);
}
