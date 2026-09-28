import type { ProviderId } from '../../src/lib/connections';
import type { ConnectionRecord, ConnectionStore, ConnectionWrite, NewTransaction, OAuthTransaction, StoredStatus } from './store';

export function createMemoryStore(): ConnectionStore {
  const transactions: OAuthTransaction[] = [];
  const connections: ConnectionRecord[] = [];

  return {
    async createTransaction(input: NewTransaction, now: Date) {
      for (let i = transactions.length - 1; i >= 0; i -= 1) {
        const tx = transactions[i];
        if (tx.expiresAt <= now || (tx.userId === input.userId && tx.provider === input.provider && tx.consumedAt)) transactions.splice(i, 1);
      }
      transactions.push({ ...input, consumedAt: null });
    },
    async consumeTransaction(stateHash, userId, provider, now) {
      const tx = transactions.find(item => item.stateHash === stateHash);
      if (!tx || tx.consumedAt) return { ok: false, reason: 'invalid_state' };
      tx.consumedAt = now;
      if (tx.userId !== userId || tx.provider !== provider) return { ok: false, reason: 'invalid_state' };
      if (tx.expiresAt <= now) return { ok: false, reason: 'expired_state' };
      return { ok: true, transaction: { ...tx } };
    },
    async getConnection(userId, provider) {
      return connections.find(item => item.userId === userId && item.provider === provider) ?? null;
    },
    async listConnections(userId) {
      return connections.filter(item => item.userId === userId).map(item => ({ ...item, scopes: [...item.scopes] }));
    },
    async saveConnection(input: ConnectionWrite) {
      const index = connections.findIndex(item => item.userId === input.userId && item.provider === input.provider);
      if (index >= 0 && connections[index].externalAccountId !== input.externalAccountId) return { ok: false, conflict: true };
      const now = input.lastAuthorizedAt;
      const record: ConnectionRecord = {
        ...input,
        scopes: [...input.scopes],
        createdAt: index >= 0 ? connections[index].createdAt : now,
        updatedAt: now,
      };
      if (index >= 0) connections[index] = record;
      else connections.push(record);
      return { ok: true, record: { ...record, scopes: [...record.scopes] } };
    },
    async deleteConnection(userId, provider) {
      const index = connections.findIndex(item => item.userId === userId && item.provider === provider);
      if (index < 0) return false;
      connections.splice(index, 1);
      return true;
    },
    async markNeedsReauthorization(userId: string, provider: ProviderId, status: StoredStatus, now: Date) {
      const row = connections.find(item => item.userId === userId && item.provider === provider);
      if (!row) return;
      row.status = status;
      row.accessTokenCiphertext = null;
      row.refreshTokenCiphertext = null;
      row.accessTokenExpiresAt = null;
      row.updatedAt = now;
    },
    async deleteTransactions(userId, provider) {
      for (let i = transactions.length - 1; i >= 0; i -= 1) {
        if (transactions[i].userId === userId && transactions[i].provider === provider) transactions.splice(i, 1);
      }
    },
  };
}
