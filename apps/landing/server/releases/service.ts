/**
 * The Release Manager service: the rules that decide what an administrator can do to a release.
 *
 * The routes are deliberately thin. Everything that matters — which state transitions are legal,
 * when a release may be published, when its slug may still change, what is written to the audit
 * trail — lives here, so the same rules apply whether a release is published from the console, from
 * the GitHub webhook, or from a future scheduled job.
 */

import { randomUUID } from 'node:crypto';
import {
  PUBLISHABLE_STATUSES,
  type ReleaseAuditAction,
  type ReleaseDraftInput,
  type ReleaseRecord,
  type ReleaseSource,
  type ReleaseStatus,
  type ReleaseStore,
} from './contracts.ts';
import { evaluateChecklist, checklistReady, blockingItems } from './checklist.ts';
import { SLUG_MAX, SLUG_PATTERN, hasTodoMarker } from './validation.ts';

export interface ReleaseActor {
  id: string;
  name: string;
  email: string;
}

export type ReleaseAction =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'revoke_approval'
  | 'await_deployment'
  | 'publish'
  | 'cancel'
  | 'restore';

export class ReleaseError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ReleaseError';
  }
}

export interface ReleaseServiceOptions {
  store: ReleaseStore;
  now?: () => Date;
  newId?: () => string;
}

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `release-${base || 'draft'}`;
}

export function createReleaseService(options: ReleaseServiceOptions) {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;

  async function audit(release: ReleaseRecord, actor: ReleaseActor | null, action: ReleaseAuditAction, detail: string | null): Promise<void> {
    await store.addAudit({
      id: newId(),
      releaseId: release.id,
      action,
      actorUserId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? null,
      detail,
      createdAt: now(),
    });
  }

  async function uniqueSlug(candidate: string, exceptId?: string): Promise<string> {
    const base = SLUG_PATTERN.test(candidate) ? candidate : slugifyTitle(candidate);
    let slug = base;
    let suffix = 2;
    // The slug is the permanent URL, so it must never silently collide with another release.
    for (;;) {
      const existing = await store.getBySlug(slug);
      if (!existing || existing.id === exceptId) return slug;
      slug = `${base.slice(0, SLUG_MAX - 6)}-${suffix}`;
      suffix += 1;
    }
  }

  async function load(id: string): Promise<ReleaseRecord> {
    const release = await store.get(id);
    if (!release) throw new ReleaseError('not_found', 'That release no longer exists.');
    return release;
  }

  return {
    async list(input: { limit: number; offset: number; status: ReleaseStatus | null }) {
      const result = await store.list(input);
      return result;
    },

    async get(id: string) {
      const release = await store.get(id);
      if (!release) return null;
      const [sources, auditEntries, decisions] = await Promise.all([
        store.listSources(id),
        store.listAudit(id),
        store.listChecklistDecisions(id),
      ]);
      const checklist = evaluateChecklist({ release, sources, decisions });
      return { release, sources, audit: auditEntries, checklist };
    },

    async create(actor: ReleaseActor, input: ReleaseDraftInput): Promise<ReleaseRecord> {
      const timestamp = now();
      const title = (input.title ?? '').trim();
      const slug = await uniqueSlug(input.slug?.trim() || slugifyTitle(title || 'untitled release'));
      const release: ReleaseRecord = {
        id: newId(),
        slug,
        title,
        summary: (input.summary ?? '').trim(),
        body: (input.body ?? '').trim(),
        categories: input.categories ?? [],
        status: 'draft',
        releaseDate: input.releaseDate ?? todayUtc(timestamp),
        links: input.links ?? [],
        heroImageUrl: input.heroImageUrl ?? null,
        shareText: input.shareText ?? null,
        highlights: input.highlights ?? [],
        audience: input.audience ?? null,
        authorUserId: actor.id,
        authorName: actor.name,
        authorEmail: actor.email,
        approvedByUserId: null,
        approvedAt: null,
        publishedAt: null,
        publishedByUserId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const created = await store.create({ release });
      await audit(created, actor, 'created', `Draft created as “${created.title || 'Untitled release'}”.`);
      return created;
    },

    /**
     * Edit a release. The slug is frozen once the release is published — that URL is permanent —
     * and a published release keeps its publication timestamp while its content can still be
     * corrected.
     */
    async update(actor: ReleaseActor, id: string, patch: ReleaseDraftInput): Promise<ReleaseRecord> {
      const release = await load(id);
      if (release.status === 'cancelled' && Object.keys(patch).length > 0) {
        throw new ReleaseError('invalid_state', 'A cancelled release is read-only. Restore it to a draft first.');
      }
      const next: Partial<ReleaseRecord> = { updatedAt: now() };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.summary !== undefined) next.summary = patch.summary;
      if (patch.body !== undefined) next.body = patch.body;
      if (patch.categories !== undefined) next.categories = patch.categories;
      if (patch.releaseDate !== undefined) next.releaseDate = patch.releaseDate;
      if (patch.links !== undefined) next.links = patch.links;
      if (patch.heroImageUrl !== undefined) next.heroImageUrl = patch.heroImageUrl;
      if (patch.shareText !== undefined) next.shareText = patch.shareText;
      if (patch.highlights !== undefined) next.highlights = patch.highlights;
      if (patch.audience !== undefined) next.audience = patch.audience;
      if (patch.slug !== undefined) {
        const requested = patch.slug.trim();
        // Sending the same slug again is not a change: a published entry can still be corrected in
        // place, and the console sends the whole form. Only a different slug is refused once the
        // release is published, because that URL is permanent.
        if (requested && requested !== release.slug) {
          if (release.status === 'published') {
            throw new ReleaseError('slug_locked', 'The slug is permanent once a release is published, so the link never breaks.');
          }
          next.slug = await uniqueSlug(requested, release.id);
        }
      }
      const updated = await store.update(id, next);
      if (!updated) throw new ReleaseError('not_found', 'That release no longer exists.');
      await audit(updated, actor, release.status === 'published' ? 'corrected' : 'updated', `Content updated (${Object.keys(patch).join(', ')}).`);
      return updated;
    },

    /**
     * Apply a lifecycle action. The transition table is the whole workflow; anything not listed is
     * refused, so a mistyped request can never move a release sideways.
     */
    async transition(actor: ReleaseActor, id: string, action: ReleaseAction, note?: string): Promise<ReleaseRecord> {
      const release = await load(id);
      const timestamp = now();
      const allowed: Record<ReleaseAction, ReleaseStatus[]> = {
        submit: ['draft'],
        approve: ['in_review'],
        reject: ['in_review'],
        revoke_approval: ['approved'],
        await_deployment: ['approved'],
        publish: PUBLISHABLE_STATUSES,
        cancel: ['draft', 'in_review', 'approved', 'awaiting_deployment'],
        restore: ['cancelled'],
      };
      if (!allowed[action]?.includes(release.status)) {
        throw new ReleaseError('invalid_transition', `A release in “${release.status}” cannot be ${describeAction(action)}.`);
      }

      if (action === 'submit') {
        if (!release.title.trim() || !release.summary.trim()) {
          throw new ReleaseError('incomplete', 'A release needs a title and a summary before it can be sent for review.');
        }
        const updated = await store.update(id, { status: 'in_review', updatedAt: timestamp });
        await audit(updated!, actor, 'submitted', note ?? 'Sent for review.');
        return updated!;
      }

      if (action === 'approve') {
        const updated = await store.update(id, {
          status: 'approved',
          approvedAt: timestamp,
          approvedByUserId: actor.id,
          updatedAt: timestamp,
        });
        await audit(updated!, actor, 'approved', note ?? 'Approved for publication.');
        return updated!;
      }

      if (action === 'reject') {
        const updated = await store.update(id, { status: 'draft', updatedAt: timestamp });
        await audit(updated!, actor, 'rejected', note ?? 'Sent back to draft.');
        return updated!;
      }

      if (action === 'revoke_approval') {
        const updated = await store.update(id, { status: 'draft', approvedAt: null, approvedByUserId: null, updatedAt: timestamp });
        await audit(updated!, actor, 'approval_revoked', note ?? 'Approval withdrawn.');
        return updated!;
      }

      if (action === 'await_deployment') {
        const sources = await store.listSources(id);
        if (!sources.some(source => source.kind === 'deployment')) {
          throw new ReleaseError('no_deployment', 'Link the deployment this release waits for before marking it as awaiting deployment.');
        }
        const updated = await store.update(id, { status: 'awaiting_deployment', updatedAt: timestamp });
        await audit(updated!, actor, 'updated', note ?? 'Marked as awaiting deployment.');
        return updated!;
      }

      if (action === 'cancel') {
        const updated = await store.update(id, { status: 'cancelled', updatedAt: timestamp });
        await audit(updated!, actor, 'cancelled', note ?? 'Cancelled.');
        return updated!;
      }

      if (action === 'restore') {
        const updated = await store.update(id, { status: 'draft', updatedAt: timestamp });
        await audit(updated!, actor, 'updated', note ?? 'Restored as a draft.');
        return updated!;
      }

      // publish
      const sources = await store.listSources(id);
      const decisions = await store.listChecklistDecisions(id);
      const checklist = evaluateChecklist({ release, sources, decisions });
      const blockers = blockingItems(checklist);
      if (blockers.length > 0) {
        throw new ReleaseError('checklist_incomplete', 'The release checklist is not complete yet.', {
          blockers: blockers.map(item => ({ key: item.key, label: item.label, status: item.status, detail: item.detail })),
        });
      }
      if (hasTodoMarker(release.body)) {
        throw new ReleaseError('incomplete', 'The release notes still contain TODO markers.');
      }
      const updated = await store.update(id, {
        status: 'published',
        publishedAt: timestamp,
        publishedByUserId: actor.id,
        updatedAt: timestamp,
      });
      await audit(updated!, actor, 'published', note ?? `Published as /changelog/${updated!.slug}.`);
      return updated!;
    },

    async addSource(actor: ReleaseActor, id: string, source: ReleaseSource): Promise<ReleaseSource> {
      const release = await load(id);
      const created = await store.addSource(source);
      await audit(release, actor, 'source_linked', `Linked ${source.kind.replace('_', ' ')} ${source.externalId ?? ''}`.trim());
      return created;
    },

    async updateSource(actor: ReleaseActor, releaseId: string, sourceId: string, patch: Partial<ReleaseSource>): Promise<ReleaseSource | null> {
      const release = await load(releaseId);
      const updated = await store.updateSource(sourceId, patch);
      if (updated) await audit(release, actor, 'source_updated', `Updated ${updated.kind.replace('_', ' ')} ${updated.externalId ?? ''}`.trim());
      return updated;
    },

    async removeSource(actor: ReleaseActor, releaseId: string, sourceId: string): Promise<boolean> {
      const release = await load(releaseId);
      const removed = await store.removeSource(sourceId);
      if (removed) await audit(release, actor, 'source_removed', 'Removed a linked source.');
      return removed;
    },

    async setChecklistDecision(actor: ReleaseActor, id: string, key: string, decision: 'confirmed' | 'unconfirmed' | 'not_applicable', note: string | null): Promise<void> {
      const release = await load(id);
      await store.setChecklistDecision({ releaseId: id, key: key as never, decision, note, actorUserId: actor.id });
      await audit(release, actor, 'checklist_updated', `Checklist item “${key}” marked ${decision.replace('_', ' ')}.`);
    },

    async recordDraftGenerated(actor: ReleaseActor, id: string, detail: string): Promise<void> {
      const release = await load(id);
      await audit(release, actor, 'draft_generated', detail);
    },

    /** The readiness summary the admin console shows next to the publish button. */
    async readiness(id: string) {
      const release = await load(id);
      const [sources, decisions] = await Promise.all([
        store.listSources(id),
        store.listChecklistDecisions(id),
      ]);
      const checklist = evaluateChecklist({ release, sources, decisions });
      return { checklist, ready: checklistReady(checklist), blockers: blockingItems(checklist) };
    },
  };
}

export type ReleaseService = ReturnType<typeof createReleaseService>;

function describeAction(action: ReleaseAction): string {
  switch (action) {
    case 'submit': return 'sent for review';
    case 'approve': return 'approved';
    case 'reject': return 'sent back';
    case 'revoke_approval': return 'have its approval withdrawn';
    case 'await_deployment': return 'wait for a deployment';
    case 'publish': return 'published';
    case 'cancel': return 'cancelled';
    case 'restore': return 'restored';
    default: return 'changed';
  }
}
