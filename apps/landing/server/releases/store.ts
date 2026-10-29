/**
 * PostgreSQL store for the Release Manager.
 *
 * One database, the same one Intake already uses. The queries here are deliberately narrow: list
 * screens select the summary columns, and the public query selects only published releases, so a
 * draft can never leak through a public read path.
 */

import type { Pool } from 'pg';
import type {
  ChecklistDecision, ChecklistKey, DeploymentState, PublicRelease, ReleaseAuditEntry, ReleaseCategory,
  ReleaseLink, ReleaseListItem, ReleaseRecord, ReleaseSource, ReleaseSourceKind, ReleaseSourceProvider,
  ReleaseStatus, ReleaseStore,
} from './contracts.ts';

type Queryable = Pick<Pool, 'query'>;
type DbRow = Record<string, unknown>;

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(entry => String(entry));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(entry => String(entry)) : [];
    } catch { return []; }
  }
  return [];
}

function toLinks(value: unknown): ReleaseLink[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const entry = row as Record<string, unknown>;
    const label = typeof entry.label === 'string' ? entry.label : '';
    const url = typeof entry.url === 'string' ? entry.url : '';
    return label && url ? [{ label, url }] : [];
  });
}

function toCategories(value: unknown): ReleaseCategory[] {
  return toStringArray(value).filter((entry): entry is ReleaseCategory =>
    entry === 'feature' || entry === 'improvement' || entry === 'fix' || entry === 'security');
}

function mapRelease(row: DbRow): ReleaseRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title ?? ''),
    summary: String(row.summary ?? ''),
    body: String(row.body ?? ''),
    categories: toCategories(row.categories),
    status: String(row.status) as ReleaseStatus,
    releaseDate: toIsoDate(row.release_date),
    links: toLinks(row.links),
    heroImageUrl: row.hero_image_url === null || row.hero_image_url === undefined ? null : String(row.hero_image_url),
    shareText: row.share_text === null || row.share_text === undefined ? null : String(row.share_text),
    highlights: toStringArray(row.highlights).map(entry => entry.trim()).filter(Boolean),
    audience: row.audience === null || row.audience === undefined ? null : String(row.audience),
    authorUserId: row.author_user_id === null || row.author_user_id === undefined ? null : String(row.author_user_id),
    authorName: row.author_name === null || row.author_name === undefined ? null : String(row.author_name),
    authorEmail: row.author_email === null || row.author_email === undefined ? null : String(row.author_email),
    approvedByUserId: row.approved_by_user_id === null || row.approved_by_user_id === undefined ? null : String(row.approved_by_user_id),
    approvedAt: toDate(row.approved_at),
    publishedAt: toDate(row.published_at),
    publishedByUserId: row.published_by_user_id === null || row.published_by_user_id === undefined ? null : String(row.published_by_user_id),
    createdAt: toDate(row.created_at) ?? new Date(0),
    updatedAt: toDate(row.updated_at) ?? new Date(0),
  };
}

function mapSource(row: DbRow): ReleaseSource {
  return {
    id: String(row.id),
    releaseId: String(row.release_id),
    kind: String(row.kind) as ReleaseSourceKind,
    provider: String(row.provider) as ReleaseSourceProvider,
    externalId: row.external_id === null || row.external_id === undefined ? null : String(row.external_id),
    url: row.url === null || row.url === undefined ? null : String(row.url),
    title: row.title === null || row.title === undefined ? null : String(row.title),
    detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
    labels: toStringArray(row.labels),
    state: row.state === null || row.state === undefined ? null : String(row.state),
    deploymentState: row.deployment_state === null || row.deployment_state === undefined ? null : String(row.deployment_state) as DeploymentState,
    deploymentEnvironment: row.deployment_environment === null || row.deployment_environment === undefined ? null : String(row.deployment_environment),
    deploymentRef: row.deployment_ref === null || row.deployment_ref === undefined ? null : String(row.deployment_ref),
    deploymentSha: row.deployment_sha === null || row.deployment_sha === undefined ? null : String(row.deployment_sha),
    createdAt: toDate(row.created_at) ?? new Date(0),
    updatedAt: toDate(row.updated_at) ?? new Date(0),
  };
}

const RELEASE_COLUMNS = `id, slug, title, summary, body, categories, status, to_char(release_date, 'YYYY-MM-DD') AS release_date,
  links, hero_image_url, share_text, highlights, audience, author_user_id, author_name, author_email,
  approved_by_user_id, approved_at, published_at, published_by_user_id, created_at, updated_at`;

const SOURCE_COLUMNS = `id, release_id, kind, provider, external_id, url, title, detail, labels, state,
  deployment_state, deployment_environment, deployment_ref, deployment_sha, created_at, updated_at`;

export function createPostgresReleaseStore(pool: Queryable): ReleaseStore {
  return {
    async list(input) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (input.status) {
        values.push(input.status);
        conditions.push(`status = $${values.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = await pool.query(`SELECT count(*)::int AS total FROM release ${where}`, values);
      const rows = await pool.query(
        `SELECT r.id, r.slug, r.title, r.summary, r.status, r.categories,
                to_char(r.release_date, 'YYYY-MM-DD') AS release_date, r.published_at, r.updated_at, r.author_name,
                (SELECT count(*)::int FROM release_source s WHERE s.release_id = r.id) AS source_count,
                (SELECT count(*)::int FROM release_source d WHERE d.release_id = r.id AND d.kind = 'deployment') AS deployment_count,
                (SELECT d.deployment_state FROM release_source d WHERE d.release_id = r.id AND d.kind = 'deployment' ORDER BY d.updated_at DESC LIMIT 1) AS deployment_state
           FROM release r ${where}
          ORDER BY COALESCE(r.published_at, r.updated_at) DESC, r.created_at DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, input.limit, input.offset],
      );
      const items: ReleaseListItem[] = rows.rows.map(row => ({
        id: String(row.id),
        slug: String(row.slug),
        title: String(row.title ?? ''),
        summary: String(row.summary ?? ''),
        status: String(row.status) as ReleaseStatus,
        categories: toCategories(row.categories),
        releaseDate: toIsoDate(row.release_date),
        publishedAt: toDate(row.published_at),
        updatedAt: toDate(row.updated_at) ?? new Date(0),
        authorName: row.author_name === null || row.author_name === undefined ? null : String(row.author_name),
        sourceCount: Number(row.source_count ?? 0),
        hasDeployment: Number(row.deployment_count ?? 0) > 0,
        deploymentState: row.deployment_state === null || row.deployment_state === undefined ? null : String(row.deployment_state) as DeploymentState,
      }));
      return { items, total: Number(total.rows[0]?.total ?? 0) };
    },

    async get(id) {
      const result = await pool.query(`SELECT ${RELEASE_COLUMNS} FROM release WHERE id = $1`, [id]);
      return result.rows[0] ? mapRelease(result.rows[0]) : null;
    },

    async getBySlug(slug) {
      const result = await pool.query(`SELECT ${RELEASE_COLUMNS} FROM release WHERE slug = $1`, [slug]);
      return result.rows[0] ? mapRelease(result.rows[0]) : null;
    },

    async create(input) {
      const release = input.release;
      const result = await pool.query(
        `INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, hero_image_url,
            share_text, highlights, audience, author_user_id, author_name, author_email, approved_by_user_id, approved_at, published_at,
            published_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING ${RELEASE_COLUMNS}`,
        [
          release.id, release.slug, release.title, release.summary, release.body, release.categories, release.status,
          release.releaseDate, JSON.stringify(release.links), release.heroImageUrl, release.shareText,
          release.highlights, release.audience,
          release.authorUserId, release.authorName, release.authorEmail, release.approvedByUserId, release.approvedAt,
          release.publishedAt, release.publishedByUserId, release.createdAt, release.updatedAt,
        ],
      );
      return mapRelease(result.rows[0]);
    },

    async update(id, patch) {
      const columns: Record<string, string> = {
        title: 'title', summary: 'summary', body: 'body', slug: 'slug', status: 'status',
        releaseDate: 'release_date', heroImageUrl: 'hero_image_url', shareText: 'share_text',
        audience: 'audience',
        authorUserId: 'author_user_id', authorName: 'author_name', authorEmail: 'author_email',
        approvedByUserId: 'approved_by_user_id', approvedAt: 'approved_at', publishedAt: 'published_at',
        publishedByUserId: 'published_by_user_id', updatedAt: 'updated_at',
      };
      const assignments: string[] = [];
      const values: unknown[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value === undefined) continue;
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
      if (patch.categories !== undefined) {
        values.push(patch.categories);
        assignments.push(`categories = $${values.length}`);
      }
      if (patch.links !== undefined) {
        values.push(JSON.stringify(patch.links));
        assignments.push(`links = $${values.length}::jsonb`);
      }
      if (patch.highlights !== undefined) {
        values.push(patch.highlights);
        assignments.push(`highlights = $${values.length}`);
      }
      if (assignments.length === 0) return this.get(id);
      values.push(id);
      const result = await pool.query(
        `UPDATE release SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING ${RELEASE_COLUMNS}`,
        values,
      );
      return result.rows[0] ? mapRelease(result.rows[0]) : null;
    },

    async listPublished(input) {
      const total = await pool.query(`SELECT count(*)::int AS total FROM release WHERE status = 'published'`);
      const result = await pool.query(
        `SELECT ${RELEASE_COLUMNS} FROM release WHERE status = 'published'
          ORDER BY COALESCE(release_date, published_at) DESC, published_at DESC
          LIMIT $1 OFFSET $2`,
        [input.limit, input.offset],
      );
      const items: PublicRelease[] = result.rows.map(row => {
        const release = mapRelease(row);
        return {
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
        };
      });
      return { items, total: Number(total.rows[0]?.total ?? 0) };
    },

    async getPublishedBySlug(slug) {
      const result = await pool.query(
        `SELECT ${RELEASE_COLUMNS} FROM release WHERE slug = $1 AND status = 'published'`,
        [slug],
      );
      if (!result.rows[0]) return null;
      const release = mapRelease(result.rows[0]);
      return {
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
      };
    },

    async listSources(releaseId) {
      const result = await pool.query(
        `SELECT ${SOURCE_COLUMNS} FROM release_source WHERE release_id = $1 ORDER BY created_at ASC`,
        [releaseId],
      );
      return result.rows.map(mapSource);
    },

    async findSourceByExternalId(input) {
      const result = await pool.query(
        `SELECT ${SOURCE_COLUMNS} FROM release_source WHERE provider = $1 AND kind = $2 AND external_id = $3 ORDER BY updated_at DESC LIMIT 1`,
        [input.provider, input.kind, input.externalId],
      );
      return result.rows[0] ? mapSource(result.rows[0]) : null;
    },

    async addSource(source) {
      const result = await pool.query(
        `INSERT INTO release_source (id, release_id, kind, provider, external_id, url, title, detail, labels, state,
            deployment_state, deployment_environment, deployment_ref, deployment_sha, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING ${SOURCE_COLUMNS}`,
        [
          source.id, source.releaseId, source.kind, source.provider, source.externalId, source.url, source.title,
          source.detail, source.labels, source.state, source.deploymentState, source.deploymentEnvironment,
          source.deploymentRef, source.deploymentSha, source.createdAt, source.updatedAt,
        ],
      );
      return mapSource(result.rows[0]);
    },

    async updateSource(id, patch) {
      const columns: Record<string, string> = {
        kind: 'kind', provider: 'provider', externalId: 'external_id', url: 'url', title: 'title', detail: 'detail',
        state: 'state', deploymentState: 'deployment_state', deploymentEnvironment: 'deployment_environment',
        deploymentRef: 'deployment_ref', deploymentSha: 'deployment_sha', updatedAt: 'updated_at',
      };
      const assignments: string[] = [];
      const values: unknown[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value === undefined) continue;
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
      if (patch.labels !== undefined) {
        values.push(patch.labels);
        assignments.push(`labels = $${values.length}`);
      }
      if (assignments.length === 0) {
        const existing = await pool.query(`SELECT ${SOURCE_COLUMNS} FROM release_source WHERE id = $1`, [id]);
        return existing.rows[0] ? mapSource(existing.rows[0]) : null;
      }
      values.push(id);
      const result = await pool.query(
        `UPDATE release_source SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING ${SOURCE_COLUMNS}`,
        values,
      );
      return result.rows[0] ? mapSource(result.rows[0]) : null;
    },

    async removeSource(id) {
      const result = await pool.query('DELETE FROM release_source WHERE id = $1', [id]);
      return Boolean(result.rowCount);
    },

    async listAudit(releaseId) {
      const result = await pool.query(
        `SELECT id, release_id, action, actor_user_id, actor_name, actor_email, detail, created_at
           FROM release_audit WHERE release_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`,
        [releaseId],
      );
      return result.rows.map(row => ({
        id: String(row.id),
        releaseId: String(row.release_id),
        action: String(row.action) as ReleaseAuditEntry['action'],
        actorUserId: row.actor_user_id === null || row.actor_user_id === undefined ? null : String(row.actor_user_id),
        actorName: row.actor_name === null || row.actor_name === undefined ? null : String(row.actor_name),
        actorEmail: row.actor_email === null || row.actor_email === undefined ? null : String(row.actor_email),
        detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
        createdAt: toDate(row.created_at) ?? new Date(0),
      }));
    },

    async addAudit(entry) {
      await pool.query(
        `INSERT INTO release_audit (id, release_id, action, actor_user_id, actor_name, actor_email, detail, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [entry.id, entry.releaseId, entry.action, entry.actorUserId, entry.actorName, entry.actorEmail, entry.detail, entry.createdAt],
      );
    },

    async listChecklistDecisions(releaseId) {
      const result = await pool.query(
        'SELECT key, decision, note FROM release_checklist_item WHERE release_id = $1',
        [releaseId],
      );
      return result.rows.map(row => ({
        key: String(row.key) as ChecklistKey,
        decision: String(row.decision) as ChecklistDecision,
        note: row.note === null || row.note === undefined ? null : String(row.note),
      }));
    },

    async setChecklistDecision(input) {
      await pool.query(
        `INSERT INTO release_checklist_item (release_id, key, decision, note, updated_at, updated_by_user_id)
         VALUES ($1,$2,$3,$4, now(), $5)
         ON CONFLICT (release_id, key)
         DO UPDATE SET decision = EXCLUDED.decision, note = EXCLUDED.note, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
        [input.releaseId, input.key, input.decision, input.note, input.actorUserId],
      );
    },

    async recordWebhookDelivery(input) {
      const result = await pool.query(
        `INSERT INTO release_webhook_event (delivery_id, event_type) VALUES ($1,$2) ON CONFLICT (delivery_id) DO NOTHING`,
        [input.deliveryId, input.eventType],
      );
      return Boolean(result.rowCount);
    },
  };
}
