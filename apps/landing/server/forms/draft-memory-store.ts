import type { DraftRecord, DraftStore } from './draft-store';

/** Test store with the same ownership and compare-and-swap semantics as PostgreSQL. */
export function createMemoryDraftStore(): DraftStore & { all(): DraftRecord[] } {
  const records = new Map<string, DraftRecord>();
  const copy = (value: DraftRecord): DraftRecord => structuredClone(value);
  return {
    async create(input, now) {
      if (records.has(input.id)) throw new Error('duplicate draft');
      const draft: DraftRecord = { ...input, version: 1, status: 'ready', result: null, createdAt: now, updatedAt: now };
      records.set(input.id, copy(draft));
      return copy(draft);
    },
    async get(userId, id) {
      const draft = records.get(id);
      return draft?.userId === userId ? copy(draft) : null;
    },
    async revise(userId, id, version, changes, now) {
      const draft = records.get(id);
      if (!draft || draft.userId !== userId || draft.status !== 'ready' || draft.version !== version) return null;
      const updated: DraftRecord = { ...draft, ...changes, version: version + 1, result: null, updatedAt: now };
      records.set(id, copy(updated));
      return copy(updated);
    },
    async claim(userId, id, version, now) {
      const draft = records.get(id);
      if (!draft || draft.userId !== userId || draft.status !== 'ready' || draft.version !== version) return null;
      const updated: DraftRecord = { ...draft, status: 'creating', result: null, updatedAt: now };
      records.set(id, copy(updated));
      return copy(updated);
    },
    async finish(userId, id, status, result, now) {
      const draft = records.get(id);
      if (!draft || draft.userId !== userId || draft.status !== 'creating') return false;
      records.set(id, copy({ ...draft, status, result, updatedAt: now }));
      return true;
    },
    async discard(userId, id) {
      const draft = records.get(id);
      if (!draft || draft.userId !== userId || draft.status !== 'ready') return false;
      return records.delete(id);
    },
    all() { return [...records.values()].map(copy); },
  };
}
