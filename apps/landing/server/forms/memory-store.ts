import type { FormLibraryFilter, FormLibraryRecord, FormRecord, FormStore, FormSummaryRecord } from './store';

/** In-memory store with the same guarantees as the Postgres one. Used by tests. */
export function createMemoryFormStore(): FormStore & { all(): FormRecord[] } {
  const records: FormRecord[] = [];
  return {
    async save(input, now) {
      if (records.some(record => record.provider === input.provider && record.providerFormId === input.providerFormId)) {
        throw Object.assign(new Error('duplicate provider form'), { code: '23505' });
      }
      const record: FormRecord = {
        ...input,
        description: input.description ?? input.specification?.description ?? null,
        source: input.source ?? 'created',
        lastSyncedAt: input.lastSyncedAt ?? (input.status === 'created' ? now : null),
        archivedAt: input.archivedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      return structuredClone(record);
    },
    async listForUser(userId, limit) {
      return records
        .filter(record => record.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map(({ id, provider, providerFormId, title, status, failureStage, editUrl, responderUrl, createdAt }): FormSummaryRecord => ({ id, provider, providerFormId, title, status, failureStage, editUrl, responderUrl, createdAt }));
    },
    async listLibrary(userId, filter: FormLibraryFilter = {}) {
      const query = filter.query?.trim().toLowerCase();
      let filtered = records.filter(record => {
        if (record.userId !== userId) return false;
        if (filter.archived === true) {
          if (!record.archivedAt) return false;
        } else if (filter.archived !== 'all') {
          if (record.archivedAt) return false;
        }
        if (filter.provider && filter.provider !== 'all' && record.provider !== filter.provider) return false;
        if (filter.source && filter.source !== 'all' && record.source !== filter.source) return false;
        if (query) {
          const matchTitle = record.title.toLowerCase().includes(query);
          const matchDesc = (record.description ?? '').toLowerCase().includes(query);
          if (!matchTitle && !matchDesc) return false;
        }
        return true;
      });

      const sort = filter.sort ?? 'newest';
      filtered = filtered.sort((a, b) => {
        if (sort === 'oldest') return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1);
        if (sort === 'title_asc') return a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1);
        if (sort === 'title_desc') return b.title.localeCompare(a.title) || (a.id < b.id ? 1 : -1);
        if (sort === 'updated') return b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1);
        if (sort === 'synced') {
          const aSync = a.lastSyncedAt?.getTime() ?? 0;
          const bSync = b.lastSyncedAt?.getTime() ?? 0;
          return bSync - aSync || b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
        }
        return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
      });

      const limit = Math.min(Math.max(1, filter.limit ?? 50), 100);
      return filtered.slice(0, limit).map((r): FormLibraryRecord => ({
        id: r.id,
        provider: r.provider,
        providerFormId: r.providerFormId,
        title: r.title,
        description: r.description,
        status: r.status,
        failureStage: r.failureStage,
        editUrl: r.editUrl,
        responderUrl: r.responderUrl,
        source: r.source,
        lastSyncedAt: r.lastSyncedAt,
        archivedAt: r.archivedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    },
    async getForUser(userId, id) {
      const record = records.find(item => item.id === id && item.userId === userId);
      return record ? structuredClone(record) : null;
    },
    async getByProviderFormId(userId, provider, providerFormId) {
      const record = records.find(item => item.userId === userId && item.provider === provider && item.providerFormId === providerFormId);
      return record ? structuredClone(record) : null;
    },
    async updateMetadata(input, now) {
      const record = records.find(item => item.id === input.id && item.userId === input.userId && item.provider === 'google' &&
        item.providerFormId === input.providerFormId && item.externalAccountId === input.externalAccountId);
      if (!record) return false;
      record.title = input.title;
      record.editUrl = input.editUrl;
      if (input.description !== undefined) record.description = input.description;
      if (record.status === 'created' && input.responderUrl) record.responderUrl = input.responderUrl;
      if (record.status === 'incomplete') record.responderUrl = null;
      record.lastSyncedAt = now;
      record.updatedAt = now;
      return true;
    },
    async archive(userId, id, archived, now) {
      const record = records.find(item => item.id === id && item.userId === userId);
      if (!record) return false;
      record.archivedAt = archived ? now : null;
      record.updatedAt = now;
      return true;
    },
    async remove(userId, id) {
      const index = records.findIndex(item => item.id === id && item.userId === userId);
      if (index === -1) return false;
      records.splice(index, 1);
      return true;
    },
    async touchSync(userId, id, metadata: { title: string; description: string | null; editUrl: string | null; responderUrl: string | null }, now) {
      const record = records.find(item => item.id === id && item.userId === userId);
      if (!record) return false;
      record.title = metadata.title;
      record.description = metadata.description;
      record.editUrl = metadata.editUrl;
      if (record.status === 'created') record.responderUrl = metadata.responderUrl;
      record.lastSyncedAt = now;
      record.updatedAt = now;
      return true;
    },
    all() {
      return records.map(record => structuredClone(record));
    },
  };
}
