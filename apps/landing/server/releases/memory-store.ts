/**
 * In-memory Release Manager store.
 *
 * Used by the tests and by the local harness. It behaves like the PostgreSQL store — including the
 * "a published release is the only thing a public read can see" rule — without needing a database.
 */

import { randomUUID } from 'node:crypto';
import type {
  ChecklistDecision, ChecklistKey, PublicRelease, ReleaseAuditEntry, ReleaseListItem, ReleaseRecord,
  ReleaseSource, ReleaseStore,
} from './contracts.ts';

export interface MemoryReleaseStore extends ReleaseStore {
  /** Test helper: every record the store holds, newest last. */
  all(): ReleaseRecord[];
  /** Test helper: every webhook delivery id already processed. */
  deliveries(): string[];
}

export function createMemoryReleaseStore(releases: ReleaseRecord[] = []): MemoryReleaseStore {
  const releaseRows = [...releases];
  const sourceRows: ReleaseSource[] = [];
  const auditRows: ReleaseAuditEntry[] = [];
  const checklistRows: Array<{ releaseId: string; key: ChecklistKey; decision: ChecklistDecision; note: string | null }> = [];
  const deliveryRows: Array<{ deliveryId: string; eventType: string }> = [];

  const toPublic = (release: ReleaseRecord): PublicRelease => ({
    slug: release.slug,
    title: release.title,
    summary: release.summary,
    body: release.body,
    categories: release.categories,
    releaseDate: release.releaseDate,
    publishedAt: release.publishedAt ? release.publishedAt.toISOString() : null,
    links: release.links,
    heroImageUrl: release.heroImageUrl,
    highlights: release.highlights,
    audience: release.audience,
  });

  const toListItem = (release: ReleaseRecord): ReleaseListItem => {
    const sources = sourceRows.filter(source => source.releaseId === release.id);
    const deployment = sources.filter(source => source.kind === 'deployment').sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return {
      id: release.id,
      slug: release.slug,
      title: release.title,
      summary: release.summary,
      status: release.status,
      categories: release.categories,
      releaseDate: release.releaseDate,
      publishedAt: release.publishedAt,
      updatedAt: release.updatedAt,
      authorName: release.authorName,
      sourceCount: sources.length,
      hasDeployment: Boolean(deployment),
      deploymentState: deployment?.deploymentState ?? null,
    };
  };

  return {
    async list(input) {
      const filtered = input.status ? releaseRows.filter(release => release.status === input.status) : releaseRows;
      const ordered = [...filtered].sort((a, b) => {
        const left = (a.publishedAt ?? a.updatedAt).getTime();
        const right = (b.publishedAt ?? b.updatedAt).getTime();
        return right - left;
      });
      return { items: ordered.slice(input.offset, input.offset + input.limit).map(toListItem), total: ordered.length };
    },
    async get(id) {
      return releaseRows.find(release => release.id === id) ?? null;
    },
    async getBySlug(slug) {
      return releaseRows.find(release => release.slug === slug) ?? null;
    },
    async create(input) {
      releaseRows.push(input.release);
      return input.release;
    },
    async update(id, patch) {
      const index = releaseRows.findIndex(release => release.id === id);
      if (index === -1) return null;
      const merged = { ...releaseRows[index], ...patch } as ReleaseRecord;
      releaseRows[index] = merged;
      return merged;
    },
    async listPublished(input) {
      const published = releaseRows.filter(release => release.status === 'published');
      const ordered = [...published].sort((a, b) => {
        const left = (a.releaseDate ?? a.publishedAt ?? a.createdAt).toString();
        const right = (b.releaseDate ?? b.publishedAt ?? b.createdAt).toString();
        return right.localeCompare(left);
      });
      return { items: ordered.slice(input.offset, input.offset + input.limit).map(toPublic), total: ordered.length };
    },
    async getPublishedBySlug(slug) {
      const release = releaseRows.find(entry => entry.slug === slug && entry.status === 'published');
      return release ? toPublic(release) : null;
    },
    async listSources(releaseId) {
      return sourceRows.filter(source => source.releaseId === releaseId);
    },
    async findSourceByExternalId(input) {
      return sourceRows.find(source =>
        source.provider === input.provider && source.kind === input.kind && source.externalId === input.externalId) ?? null;
    },
    async addSource(source) {
      sourceRows.push(source);
      return source;
    },
    async updateSource(id, patch) {
      const index = sourceRows.findIndex(source => source.id === id);
      if (index === -1) return null;
      sourceRows[index] = { ...sourceRows[index], ...patch } as ReleaseSource;
      return sourceRows[index];
    },
    async removeSource(id) {
      const index = sourceRows.findIndex(source => source.id === id);
      if (index === -1) return false;
      sourceRows.splice(index, 1);
      return true;
    },
    async listAudit(releaseId) {
      return auditRows.filter(entry => entry.releaseId === releaseId).slice().reverse();
    },
    async addAudit(entry) {
      auditRows.push(entry);
    },
    async listChecklistDecisions(releaseId) {
      return checklistRows.filter(row => row.releaseId === releaseId);
    },
    async setChecklistDecision(input) {
      const index = checklistRows.findIndex(row => row.releaseId === input.releaseId && row.key === input.key);
      const row = { releaseId: input.releaseId, key: input.key, decision: input.decision, note: input.note };
      if (index === -1) checklistRows.push(row);
      else checklistRows[index] = row;
    },
    async recordWebhookDelivery(input) {
      if (deliveryRows.some(row => row.deliveryId === input.deliveryId)) return false;
      deliveryRows.push(input);
      return true;
    },
    all() {
      return [...releaseRows];
    },
    deliveries() {
      return deliveryRows.map(row => row.deliveryId);
    },
  };
}

export function newReleaseId(): string {
  return `rel_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
