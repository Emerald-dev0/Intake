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
    all() {
      return records.map(record => ({ ...record }));
    },
  };
}
