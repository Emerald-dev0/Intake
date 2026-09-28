-- Intake provider connections. These are NOT Better Auth login accounts.
-- Run after `npm run db:migrate` so the quoted "user" table exists.
-- Tokens are application-encrypted ciphertext. Do not add plaintext token columns.

CREATE TABLE IF NOT EXISTS provider_connection (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  status text NOT NULL CHECK (status IN ('connected', 'expired', 'reauthorization_required')),
  external_account_id text NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 255),
  external_account_email text CHECK (external_account_email IS NULL OR char_length(external_account_email) <= 320),
  external_account_label text CHECK (external_account_label IS NULL OR char_length(external_account_label) <= 120),
  scopes text NOT NULL DEFAULT '',
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_ciphertext text,
  last_authorized_at timestamptz,
  last_refreshed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS provider_oauth_transaction (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  state_hash text NOT NULL UNIQUE,
  code_verifier_ciphertext text NOT NULL,
  nonce_hash text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_oauth_transaction_user_idx
  ON provider_oauth_transaction (user_id, provider);
