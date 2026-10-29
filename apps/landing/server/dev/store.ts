/**
 * PostgreSQL store for the developer workspace.
 *
 * The same database Intake already uses — no second store, no second schema. The queries follow the
 * ownership chain: a form is reached through its project, and a project through its owner, so a
 * read that forgets the join returns nothing rather than somebody else's work.
 */

import type { Pool } from 'pg';
import type {
  DevForm, DevFormDefinition, DevFormVersion, DevProject, DevStore, DevSubmission, DevSubmissionPage,
  DevSubmissionQuery, DevUsageDay, DevUsageDelta,
} from './contracts.js';

type Queryable = Pick<Pool, 'query'>;
type DbRow = Record<string, unknown>;

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

function toDefinition(value: unknown): DevFormDefinition {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<DevFormDefinition>;
  return {
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    theme: {
      mode: raw.theme?.mode ?? 'system',
      primary: raw.theme?.primary ?? '#ff5a1f',
      background: raw.theme?.background ?? '#ffffff',
      text: raw.theme?.text ?? '#1a1b18',
      border: raw.theme?.border ?? '#d8d4cc',
      fontFamily: raw.theme?.fontFamily ?? null,
      radius: typeof raw.theme?.radius === 'number' ? raw.theme.radius : 8,
      transparentBackground: raw.theme?.transparentBackground === true,
    },
    submitLabel: raw.submitLabel ?? null,
    successMessage: raw.successMessage ?? null,
  };
}

function mapProject(row: DbRow): DevProject {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    status: row.status === 'archived' ? 'archived' : 'active',
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapForm(row: DbRow): DevForm {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    slug: String(row.slug),
    status: row.status as DevForm['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapSubmission(row: DbRow): DevSubmission {
  const answers = (typeof row.answers === 'object' && row.answers !== null ? row.answers : {}) as DevSubmission['answers'];
  const source = (typeof row.source === 'object' && row.source !== null ? row.source : {}) as DevSubmission['source'];
  return {
    id: String(row.id),
    formId: String(row.form_id),
    formVersionId: String(row.form_version_id),
    projectId: String(row.project_id),
    answers,
    source,
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined ? null : String(row.idempotency_key),
    submittedAt: toDate(row.submitted_at),
  };
}

function mapVersion(row: DbRow): DevFormVersion {
  return {
    id: String(row.id),
    formId: String(row.form_id),
    version: Number(row.version),
    definition: toDefinition(row.definition),
    state: row.state as DevFormVersion['state'],
    createdAt: toDate(row.created_at),
    publishedAt: toNullableDate(row.published_at),
  };
}

export function createPostgresDevStore(pool: Queryable): DevStore {
  return {
    async listProjects(userId: string) {
      const result = await pool.query(
        `SELECT id, user_id, name, slug, description, status, created_at, updated_at
           FROM dev_project
          WHERE user_id = $1
          ORDER BY updated_at DESC, name ASC`,
        [userId],
      );
      return (result.rows as DbRow[]).map(mapProject);
    },

    async getProject(userId: string, projectId: string) {
      const result = await pool.query(
        `SELECT id, user_id, name, slug, description, status, created_at, updated_at
           FROM dev_project
          WHERE id = $1 AND user_id = $2`,
        [projectId, userId],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapProject(row) : null;
    },

    async getProjectBySlug(slug: string) {
      const result = await pool.query(
        `SELECT id, user_id, name, slug, description, status, created_at, updated_at
           FROM dev_project
          WHERE slug = $1`,
        [slug],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapProject(row) : null;
    },

    async createProject(project: DevProject) {
      const result = await pool.query(
        `INSERT INTO dev_project (id, user_id, name, slug, description, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, user_id, name, slug, description, status, created_at, updated_at`,
        [project.id, project.userId, project.name, project.slug, project.description, project.status, project.createdAt, project.updatedAt],
      );
      return mapProject((result.rows as DbRow[])[0]);
    },

    async updateProject(projectId: string, patch: Partial<DevProject>) {
      const result = await pool.query(
        `UPDATE dev_project
            SET name = COALESCE($2, name),
                description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                status = COALESCE($5, status),
                updated_at = COALESCE($6, updated_at)
          WHERE id = $1
        RETURNING id, user_id, name, slug, description, status, created_at, updated_at`,
        [
          projectId,
          patch.name ?? null,
          patch.description !== undefined,
          patch.description ?? null,
          patch.status ?? null,
          patch.updatedAt ?? null,
        ],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapProject(row) : null;
    },

    async listForms(projectId: string) {
      const result = await pool.query(
        `SELECT id, project_id, name, slug, status, created_at, updated_at
           FROM dev_form
          WHERE project_id = $1
          ORDER BY updated_at DESC, name ASC`,
        [projectId],
      );
      return (result.rows as DbRow[]).map(mapForm);
    },

    async getForm(formId: string) {
      const result = await pool.query(
        `SELECT id, project_id, name, slug, status, created_at, updated_at FROM dev_form WHERE id = $1`,
        [formId],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapForm(row) : null;
    },

    async getFormBySlug(projectId: string, slug: string) {
      const result = await pool.query(
        `SELECT id, project_id, name, slug, status, created_at, updated_at
           FROM dev_form WHERE project_id = $1 AND slug = $2`,
        [projectId, slug],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapForm(row) : null;
    },

    async createForm(form: DevForm) {
      const result = await pool.query(
        `INSERT INTO dev_form (id, project_id, name, slug, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, project_id, name, slug, status, created_at, updated_at`,
        [form.id, form.projectId, form.name, form.slug, form.status, form.createdAt, form.updatedAt],
      );
      return mapForm((result.rows as DbRow[])[0]);
    },

    async updateForm(formId: string, patch: Partial<DevForm>) {
      const result = await pool.query(
        `UPDATE dev_form
            SET name = COALESCE($2, name),
                slug = COALESCE($3, slug),
                status = COALESCE($4, status),
                updated_at = COALESCE($5, updated_at)
          WHERE id = $1
        RETURNING id, project_id, name, slug, status, created_at, updated_at`,
        [formId, patch.name ?? null, patch.slug ?? null, patch.status ?? null, patch.updatedAt ?? null],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapForm(row) : null;
    },

    async listVersions(formId: string) {
      const result = await pool.query(
        `SELECT id, form_id, version, definition, state, created_at, published_at
           FROM dev_form_version
          WHERE form_id = $1
          ORDER BY version DESC`,
        [formId],
      );
      return (result.rows as DbRow[]).map(mapVersion);
    },

    async getVersion(versionId: string) {
      const result = await pool.query(
        `SELECT id, form_id, version, definition, state, created_at, published_at
           FROM dev_form_version WHERE id = $1`,
        [versionId],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapVersion(row) : null;
    },

    async getPublishedVersion(formId: string) {
      const result = await pool.query(
        `SELECT id, form_id, version, definition, state, created_at, published_at
           FROM dev_form_version
          WHERE form_id = $1 AND state = 'published'`,
        [formId],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapVersion(row) : null;
    },

    async getDraftVersion(formId: string) {
      const result = await pool.query(
        `SELECT id, form_id, version, definition, state, created_at, published_at
           FROM dev_form_version
          WHERE form_id = $1 AND state = 'draft'
          ORDER BY version DESC
          LIMIT 1`,
        [formId],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapVersion(row) : null;
    },

    async createVersion(version: DevFormVersion) {
      const result = await pool.query(
        `INSERT INTO dev_form_version (id, form_id, version, definition, state, created_at, published_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         RETURNING id, form_id, version, definition, state, created_at, published_at`,
        [
          version.id,
          version.formId,
          version.version,
          JSON.stringify(version.definition),
          version.state,
          version.createdAt,
          version.publishedAt,
        ],
      );
      return mapVersion((result.rows as DbRow[])[0]);
    },

    async createSubmission(submission: DevSubmission) {
      const result = await pool.query(
        `INSERT INTO dev_submission (id, form_id, form_version_id, project_id, answers, source, idempotency_key, submitted_at, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $8)
         RETURNING id, form_id, form_version_id, project_id, answers, source, idempotency_key, submitted_at`,
        [
          submission.id,
          submission.formId,
          submission.formVersionId,
          submission.projectId,
          JSON.stringify(submission.answers),
          JSON.stringify(submission.source),
          submission.idempotencyKey,
          submission.submittedAt,
        ],
      );
      return mapSubmission((result.rows as DbRow[])[0]);
    },

    async recordUsage(delta: DevUsageDelta) {
      await pool.query(
        `INSERT INTO dev_usage_daily (project_id, day, accepted, rejected, bytes)
         VALUES ($1, $2::date, $3, $4, $5)
         ON CONFLICT (project_id, day) DO UPDATE
           SET accepted = dev_usage_daily.accepted + EXCLUDED.accepted,
               rejected = dev_usage_daily.rejected + EXCLUDED.rejected,
               bytes = dev_usage_daily.bytes + EXCLUDED.bytes`,
        [
          delta.projectId,
          delta.day.toISOString().slice(0, 10),
          delta.accepted ?? 0,
          delta.rejected ?? 0,
          delta.bytes ?? 0,
        ],
      );
    },

    async listUsage(input: { projectId?: string; since?: Date; until?: Date }): Promise<DevUsageDay[]> {
      const where: string[] = ['1 = 1'];
      const values: unknown[] = [];
      if (input.projectId) {
        values.push(input.projectId);
        where.push(`project_id = $${values.length}`);
      }
      if (input.since) {
        values.push(input.since.toISOString().slice(0, 10));
        where.push(`day >= $${values.length}::date`);
      }
      if (input.until) {
        values.push(input.until.toISOString().slice(0, 10));
        where.push(`day <= $${values.length}::date`);
      }
      const result = await pool.query(
        `SELECT project_id, day::text AS day, accepted, rejected, bytes
           FROM dev_usage_daily
          WHERE ${where.join(' AND ')}
          ORDER BY day DESC, project_id ASC`,
        values,
      );
      return (result.rows as DbRow[]).map(row => ({
        projectId: String(row.project_id),
        day: String(row.day),
        accepted: Number(row.accepted),
        rejected: Number(row.rejected),
        bytes: Number(row.bytes),
      }));
    },

    async listSubmissions(query: DevSubmissionQuery): Promise<DevSubmissionPage> {
      const where: string[] = ['project_id = $1'];
      const values: unknown[] = [query.projectId];
      if (query.formId) {
        values.push(query.formId);
        where.push(`form_id = $${values.length}`);
      }
      if (query.search) {
        values.push(`%${query.search}%`);
        where.push(`answers::text ILIKE $${values.length}`);
      }
      if (query.since) {
        values.push(query.since);
        where.push(`submitted_at >= $${values.length}`);
      }
      if (query.until) {
        values.push(query.until);
        where.push(`submitted_at < $${values.length}`);
      }
      const clause = where.join(' AND ');

      const rows = await pool.query(
        `SELECT id, form_id, form_version_id, project_id, answers, source, idempotency_key, submitted_at
           FROM dev_submission
          WHERE ${clause}
          ORDER BY submitted_at DESC, id DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.limit, query.offset],
      );
      const total = await pool.query(`SELECT count(*)::int AS count FROM dev_submission WHERE ${clause}`, values);
      const perDay = await pool.query(
        `SELECT to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count
           FROM dev_submission
          WHERE ${clause}
          GROUP BY day
          ORDER BY day ASC`,
        values,
      );
      return {
        items: (rows.rows as DbRow[]).map(mapSubmission),
        total: Number((total.rows as DbRow[])[0]?.count ?? 0),
        perDay: (perDay.rows as DbRow[]).map(row => ({ day: String(row.day), count: Number(row.count) })),
      };
    },

    async getSubmission(submissionId: string) {
      const result = await pool.query(
        `SELECT id, form_id, form_version_id, project_id, answers, source, idempotency_key, submitted_at
           FROM dev_submission WHERE id = $1`,
        [submissionId],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapSubmission(row) : null;
    },

    async getSubmissionByIdempotencyKey(formId: string, key: string) {
      const result = await pool.query(
        `SELECT id, form_id, form_version_id, project_id, answers, source, idempotency_key, submitted_at
           FROM dev_submission
          WHERE form_id = $1 AND idempotency_key = $2`,
        [formId, key],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapSubmission(row) : null;
    },

    async updateVersion(versionId: string, patch: Partial<DevFormVersion>) {
      const result = await pool.query(
        `UPDATE dev_form_version
            SET definition = COALESCE($2::jsonb, definition),
                state = COALESCE($3, state),
                published_at = CASE WHEN $4::boolean THEN $5 ELSE published_at END
          WHERE id = $1
        RETURNING id, form_id, version, definition, state, created_at, published_at`,
        [
          versionId,
          patch.definition ? JSON.stringify(patch.definition) : null,
          patch.state ?? null,
          patch.publishedAt !== undefined,
          patch.publishedAt ?? null,
        ],
      );
      const row = (result.rows as DbRow[])[0];
      return row ? mapVersion(row) : null;
    },
  };
}
