/**
 * Postgres storage for admin-composed mail.
 *
 * Recipients are ordinary Intake accounts, so this reads the Better Auth `"user"` table directly
 * rather than keeping a second copy of anybody's address. The send log (`admin_mail_send`) holds
 * counts and who pressed the button — never the message body.
 */

import type { Pool } from 'pg';
import type { MailRecipient, MailSendRecord, MailSelection, MailStore } from './mail';

type Queryable = Pick<Pool, 'query'>;
type DbRow = Record<string, unknown>;

const NO_STORE = new Error('Admin mail storage is not available until migration 020_admin_mail.sql is applied.');

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toRecipient(row: DbRow): MailRecipient {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    email: String(row.email),
    verified: row.email_verified === true,
    createdAt: iso(row.created_at),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, character => `!${character}`);
}

export function createPostgresMailStore(pool: Queryable): MailStore {
  async function tableExists(table: string): Promise<boolean> {
    const result = await pool.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`]);
    return result.rows[0]?.present === true;
  }

  /** The WHERE clause for a segment or an explicit id list. Positional params start at $1. */
  function where(selection: MailSelection): { clause: string; params: unknown[] } {
    if (selection.kind === 'segment') {
      if (selection.segment === 'verified') return { clause: 'WHERE u."emailVerified" = true', params: [] };
      if (selection.segment === 'unverified') return { clause: 'WHERE u."emailVerified" = false', params: [] };
      return { clause: '', params: [] };
    }
    // Empty id lists are rejected upstream, so `= ANY($1)` always has at least one value here.
    return { clause: 'WHERE u.id = ANY($1::text[])', params: [selection.ids] };
  }

  return {
    ready() {
      return tableExists('admin_mail_send');
    },

    async count(selection) {
      const { clause, params } = where(selection);
      const result = await pool.query<DbRow>(`SELECT COUNT(*) AS total FROM "user" u ${clause}`, params);
      return integer(result.rows[0]?.total ?? result.rows[0]?.count);
    },

    async resolve(selection, limit) {
      const { clause, params } = where(selection);
      const result = await pool.query<DbRow>(
        `SELECT u.id, u.name, u.email, u."emailVerified" AS email_verified, u."createdAt" AS created_at
         FROM "user" u ${clause}
         ORDER BY u."createdAt" ASC, u.id ASC
         LIMIT $${params.length + 1}`,
        [...params, limit],
      );
      return result.rows.map(toRecipient);
    },

    async search({ query, segment, limit, offset }) {
      const term = query.trim().toLowerCase();
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (term) {
        params.push(`%${escapeLike(term)}%`, `%${escapeLike(query.trim())}%`);
        conditions.push(`(lower(u.email) LIKE $1 ESCAPE '!' OR lower(u.name) LIKE $1 ESCAPE '!' OR u.id LIKE $2 ESCAPE '!')`);
      }
      if (segment === 'verified') conditions.push('u."emailVerified" = true');
      if (segment === 'unverified') conditions.push('u."emailVerified" = false');
      const filter = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [total, rows] = await Promise.all([
        pool.query<DbRow>(`SELECT COUNT(*) AS total FROM "user" u ${filter}`, params),
        pool.query<DbRow>(
          `SELECT u.id, u.name, u.email, u."emailVerified" AS email_verified, u."createdAt" AS created_at
           FROM "user" u ${filter}
           ORDER BY u."createdAt" DESC, u.id DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
      ]);
      return { items: rows.rows.map(toRecipient), total: integer(total.rows[0]?.total) };
    },

    async record(record: MailSendRecord) {
      if (!await tableExists('admin_mail_send')) throw NO_STORE;
      await pool.query(
        `INSERT INTO admin_mail_send
           (id, admin_user_id, subject, selection_kind, selection_label, recipients, sent, skipped, failed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          record.id, record.adminUserId, record.subject, record.selectionKind, record.selectionLabel,
          record.recipients, record.sent, record.skipped, record.failed, record.createdAt,
        ],
      );
    },

    async recent(limit) {
      if (!await tableExists('admin_mail_send')) return [];
      const result = await pool.query<DbRow>(
        `SELECT id, admin_user_id, subject, selection_kind, selection_label, recipients, sent, skipped, failed,
           created_at
         FROM admin_mail_send ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      return result.rows.map(row => ({
        id: String(row.id),
        adminUserId: row.admin_user_id === null || row.admin_user_id === undefined ? null : String(row.admin_user_id),
        subject: String(row.subject ?? ''),
        selectionKind: row.selection_kind === 'ids' ? 'ids' : 'segment',
        selectionLabel: String(row.selection_label ?? ''),
        recipients: integer(row.recipients),
        sent: integer(row.sent),
        skipped: integer(row.skipped),
        failed: integer(row.failed),
        createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
      }));
    },
  };
}
