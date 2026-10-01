import type { FormEditDraftRecord, FormEditDraftStore, NewFormEditDraft, StoredEditStatus } from './edit-store';
import type { FormEditPlan, FormEditResult } from '../../src/lib/form-edit';

/** In-memory adapter with the same user scoping and compare-and-swap behavior as PostgreSQL. */
export function createMemoryFormEditDraftStore(): FormEditDraftStore & { all(): FormEditDraftRecord[] } {
  const records = new Map<string, FormEditDraftRecord>();
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    async create(input: NewFormEditDraft, now) {
      if (records.has(input.id)) throw new Error('duplicate edit draft');
      const row: FormEditDraftRecord = { ...input, version: 1, status: 'ready', result: null, createdAt: now, updatedAt: now };
      records.set(row.id, copy(row));
      return copy(row);
    },
    async get(userId, id) {
      const row = records.get(id);
      return row?.userId === userId ? copy(row) : null;
    },
    async revise(userId, id, version, plan: FormEditPlan, now) {
      const row = records.get(id);
      if (!row || row.userId !== userId || row.status !== 'ready' || row.version !== version) return null;
      const updated = { ...row, plan: copy(plan), version: version + 1, result: null, updatedAt: now };
      records.set(id, copy(updated));
      return copy(updated);
    },
    async claim(userId, id, version, now) {
      const row = records.get(id);
      if (!row || row.userId !== userId || row.status !== 'ready' || row.version !== version) return null;
      const updated = { ...row, status: 'applying' as const, result: null, updatedAt: now };
      records.set(id, copy(updated));
      return copy(updated);
    },
    async markStale(userId, id, version, result: FormEditResult, now) {
      const row = records.get(id);
      if (!row || row.userId !== userId || row.status !== 'ready' || row.version !== version) return false;
      records.set(id, copy({ ...row, status: 'stale', result, updatedAt: now }));
      return true;
    },
    async finish(userId, id, status: StoredEditStatus, result: FormEditResult, now, current) {
      const row = records.get(id);
      if (!row || row.userId !== userId || row.status !== 'applying') return false;
      records.set(id, copy({ ...row, ...(current ? { current } : {}), status, result, version: status === 'ready' ? row.version + 1 : row.version, updatedAt: now }));
      return true;
    },
    async discard(userId, id) {
      const row = records.get(id);
      if (!row || row.userId !== userId || row.status !== 'ready') return false;
      return records.delete(id);
    },
    all() { return [...records.values()].map(copy); },
  };
}
