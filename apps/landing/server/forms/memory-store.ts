import type { FormRecord, FormStore, FormSummaryRecord } from './store';

/** In-memory store with the same guarantees as the Postgres one. Used by tests. */
export function createMemoryFormStore(): FormStore & { all(): FormRecord[] } {
  const records: FormRecord[] = [];
  return {
    async save(input, now) {
      if (records.some(record => record.provider === input.provider && record.providerFormId === input.providerFormId)) {
        throw Object.assign(new Error('duplicate provider form'), { code: '23505' });
      }
      const record: FormRecord = { ...input, createdAt: now, updatedAt: now };
      records.push(record);
      return { ...record };
    },
    async listForUser(userId, limit) {
      return records
        .filter(record => record.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map(({ id, provider, providerFormId, title, status, failureStage, editUrl, responderUrl, createdAt }): FormSummaryRecord => ({ id, provider, providerFormId, title, status, failureStage, editUrl, responderUrl, createdAt }));
    },
    async getForUser(userId, id) {
      const record = records.find(item => item.id === id && item.userId === userId);
      return record ? structuredClone(record) : null;
    },
    async updateMetadata(input, now) {
      const record = records.find(item => item.id === input.id && item.userId === input.userId && item.provider === 'google' &&
        item.providerFormId === input.providerFormId && item.externalAccountId === input.externalAccountId);
      if (!record) return false;
      record.title = input.title;
      record.editUrl = input.editUrl;
      if (record.status === 'created' && input.responderUrl) record.responderUrl = input.responderUrl;
      if (record.status === 'incomplete') record.responderUrl = null;
      record.updatedAt = now;
      return true;
    },
    all() {
      return records.map(record => ({ ...record }));
    },
  };
}
