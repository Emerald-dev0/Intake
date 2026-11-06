import type { Pool } from 'pg';
import type { ProviderId } from '../../src/lib/connections';
import { scopesToText, textToScopes, type ConnectionRecord, type ConnectionStore, type ConnectionWrite, type NewTransaction, type OAuthTransaction, type StoredStatus } from './store';

interface ConnectionRow {
  id: string;
  user_id: string;
  provider: ProviderId;
  status: StoredStatus;
  external_account_id: string;
  external_account_email: string | null;
  external_account_label: string | null;
  scopes: string;
  access_token_ciphertext: string | null;
  access_token_expires_at: Date | null;
  refresh_token_ciphertext: string | null;
  last_authorized_at: Date | null;
  last_refreshed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface TransactionRow {
  id: string;
  user_id: string;
  provider: ProviderId;
  state_hash: string;
  code_verifier_ciphertext: string;
  nonce_hash: string;
  redirect_uri: string;
  requested_scopes: string | null;
  return_to: string | null;
  expires_at: Date;
  consumed_at: Date | null;
}

/** How long the answer to "has migration 042 run?" is remembered. */
const CONTEXT_COLUMN_CHECK_MS = 60_000;

const CONNECTION_COLUMNS = `id, user_id, provider, status, external_account_id, external_account_email, external_account_label, scopes,
  access_token_ciphertext, access_token_expires_at, refresh_token_ciphertext, last_authorized_at, last_refreshed_at, created_at, updated_at`;

function mapConnection(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    status: row.status,
    externalAccountId: row.external_account_id,
    externalAccountEmail: row.external_account_email,
    externalAccountLabel: row.external_account_label,
    scopes: textToScopes(row.scopes),
    accessTokenCiphertext: row.access_token_ciphertext,
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    lastAuthorizedAt: row.last_authorized_at,
    lastRefreshedAt: row.last_refreshed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTransaction(row: TransactionRow): OAuthTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    stateHash: row.state_hash,
    codeVerifierCiphertext: row.code_verifier_ciphertext,
    nonceHash: row.nonce_hash,
    redirectUri: row.redirect_uri,
    requestedScopes: textToScopes(row.requested_scopes),
    returnTo: row.return_to ?? null,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

/** Every read and write is scoped by the Intake user id from the server session, never from the request body. */
export function createPostgresStore(pool: Pool): ConnectionStore {
  // The transaction context columns arrived with migration 042. A deployment that runs before it
  // must still be able to connect a provider: the columns are simply not written, and the callback
  // falls back to the provider's base scopes and the default landing page. The answer is
  // remembered for a minute so a busy server does not ask the catalogue on every authorization,
  // and so a migration applied while the server is running is picked up without a restart.
  let contextColumnCheck: { at: number; present: boolean } | null = null;

  const hasContextColumns = async (): Promise<boolean> => {
    const now = Date.now();
    if (contextColumnCheck && now - contextColumnCheck.at < CONTEXT_COLUMN_CHECK_MS) return contextColumnCheck.present;
    let present = false;
    try {
      const result = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'provider_oauth_transaction'
            AND column_name IN ('requested_scopes', 'return_to')`,
      );
      present = (result.rowCount ?? 0) === 2;
    } catch {
      present = false;
    }
    contextColumnCheck = { at: now, present };
    return present;
  };

  return {
    async createTransaction(input: NewTransaction, now: Date) {
      await pool.query(
        `DELETE FROM provider_oauth_transaction
         WHERE expires_at < $1 OR (user_id = $2 AND provider = $3 AND consumed_at IS NOT NULL)`,
        [new Date(now.getTime() - 24 * 60 * 60 * 1000), input.userId, input.provider],
      );
      const context = await hasContextColumns();
      await pool.query(
        context
          ? `INSERT INTO provider_oauth_transaction
              (id, user_id, provider, state_hash, code_verifier_ciphertext, nonce_hash, redirect_uri, requested_scopes, return_to, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`
          : `INSERT INTO provider_oauth_transaction
              (id, user_id, provider, state_hash, code_verifier_ciphertext, nonce_hash, redirect_uri, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        context
          ? [
              input.id,
              input.userId,
              input.provider,
              input.stateHash,
              input.codeVerifierCiphertext,
              input.nonceHash,
              input.redirectUri,
              scopesToText(input.requestedScopes),
              input.returnTo,
              input.expiresAt,
            ]
          : [
              input.id,
              input.userId,
              input.provider,
              input.stateHash,
              input.codeVerifierCiphertext,
              input.nonceHash,
              input.redirectUri,
              input.expiresAt,
            ],
      );
    },
    async consumeTransaction(stateHash, userId, provider, now) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const context = await hasContextColumns();
        const found = await client.query<TransactionRow>(
          context
            ? `SELECT id, user_id, provider, state_hash, code_verifier_ciphertext, nonce_hash, redirect_uri, requested_scopes, return_to, expires_at, consumed_at
               FROM provider_oauth_transaction WHERE state_hash = $1 FOR UPDATE`
            : `SELECT id, user_id, provider, state_hash, code_verifier_ciphertext, nonce_hash, redirect_uri, expires_at, consumed_at
               FROM provider_oauth_transaction WHERE state_hash = $1 FOR UPDATE`,
          [stateHash],
        );
        const row = found.rows[0];
        if (!row || row.consumed_at) {
          await client.query('COMMIT');
          return { ok: false, reason: 'invalid_state' };
        }
        await client.query('UPDATE provider_oauth_transaction SET consumed_at = $2 WHERE id = $1', [row.id, now]);
        await client.query('COMMIT');
        if (row.user_id !== userId || row.provider !== provider) return { ok: false, reason: 'invalid_state' };
        if (row.expires_at <= now) return { ok: false, reason: 'expired_state' };
        return { ok: true, transaction: mapTransaction({ ...row, consumed_at: now }) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async getConnection(userId, provider) {
      const result = await pool.query<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS} FROM provider_connection WHERE user_id = $1 AND provider = $2`,
        [userId, provider],
      );
      return result.rows[0] ? mapConnection(result.rows[0]) : null;
    },
    async listConnections(userId) {
      const result = await pool.query<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS} FROM provider_connection WHERE user_id = $1 ORDER BY provider`,
        [userId],
      );
      return result.rows.map(mapConnection);
    },
    async saveConnection(input: ConnectionWrite) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<{ id: string; external_account_id: string; created_at: Date }>(
          `SELECT id, external_account_id, created_at FROM provider_connection WHERE user_id = $1 AND provider = $2 FOR UPDATE`,
          [input.userId, input.provider],
        );
        if (existing.rows[0] && existing.rows[0].external_account_id !== input.externalAccountId) {
          await client.query('ROLLBACK');
          return { ok: false, conflict: true };
        }
        const saved = await client.query<ConnectionRow>(
          `INSERT INTO provider_connection (
             id, user_id, provider, status, external_account_id, external_account_email, external_account_label, scopes,
             access_token_ciphertext, access_token_expires_at, refresh_token_ciphertext, last_authorized_at, last_refreshed_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
           ON CONFLICT (user_id, provider) DO UPDATE SET
             status = EXCLUDED.status,
             external_account_id = EXCLUDED.external_account_id,
             external_account_email = EXCLUDED.external_account_email,
             external_account_label = EXCLUDED.external_account_label,
             scopes = EXCLUDED.scopes,
             access_token_ciphertext = EXCLUDED.access_token_ciphertext,
             access_token_expires_at = EXCLUDED.access_token_expires_at,
             refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
             last_authorized_at = EXCLUDED.last_authorized_at,
             last_refreshed_at = EXCLUDED.last_refreshed_at,
             updated_at = EXCLUDED.updated_at
           RETURNING ${CONNECTION_COLUMNS}`,
          [
            existing.rows[0]?.id ?? input.id,
            input.userId,
            input.provider,
            input.status,
            input.externalAccountId,
            input.externalAccountEmail,
            input.externalAccountLabel,
            scopesToText(input.scopes),
            input.accessTokenCiphertext,
            input.accessTokenExpiresAt,
            input.refreshTokenCiphertext,
            input.lastAuthorizedAt,
            input.lastRefreshedAt,
            existing.rows[0]?.created_at ?? input.lastAuthorizedAt,
          ],
        );
        await client.query('COMMIT');
        return { ok: true, record: mapConnection(saved.rows[0]) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async deleteConnection(userId, provider) {
      const result = await pool.query('DELETE FROM provider_connection WHERE user_id = $1 AND provider = $2', [userId, provider]);
      return (result.rowCount ?? 0) > 0;
    },
    async markNeedsReauthorization(userId, provider, status, now) {
      await pool.query(
        `UPDATE provider_connection
         SET status = $3, access_token_ciphertext = NULL, refresh_token_ciphertext = NULL, access_token_expires_at = NULL, updated_at = $4
         WHERE user_id = $1 AND provider = $2`,
        [userId, provider, status, now],
      );
    },
    async deleteTransactions(userId, provider) {
      await pool.query('DELETE FROM provider_oauth_transaction WHERE user_id = $1 AND provider = $2', [userId, provider]);
    },
  };
}
