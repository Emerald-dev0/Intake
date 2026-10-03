-- Phase 11 — AI usage accounting, credit ledger and plan entitlements. Additive and non-destructive.
-- Ownership follows the existing Better Auth "user" table, exactly like provider_connection and form.
--
-- Design notes:
--   * credit_ledger is the source of truth. There is deliberately no mutable credits_remaining column.
--   * Grants are unique per (user, entry_type, period_key), so a daily/monthly allowance can never be
--     granted twice for the same period, even if two API processes start at the same moment.
--   * Consumption is unique per (user, operation_key, bucket), so a replayed logical operation cannot
--     be charged twice, while a single operation may still consume the daily bucket and then the
--     monthly reserve.
--   * user_entitlement is the per-user lock row used by the consuming transaction (SELECT ... FOR UPDATE).

CREATE TABLE IF NOT EXISTS user_entitlement (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  -- Placeholder for the future billing system: it may set plan='pro' and subscription_status='active'
  -- without any change to the credit system.
  subscription_status text NOT NULL DEFAULT 'none' CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('daily_grant', 'monthly_grant', 'ai_consumption', 'manual_adjustment', 'expiration')),
  bucket text CHECK (bucket IS NULL OR bucket IN ('daily', 'monthly')),
  -- Signed on purpose: grants are positive, consumption is negative. A balance is a SUM, never a column.
  credits integer NOT NULL CHECK (credits <> 0),
  period_key text NOT NULL CHECK (char_length(period_key) BETWEEN 4 AND 40),
  operation_key text CHECK (operation_key IS NULL OR char_length(operation_key) BETWEEN 8 AND 64),
  operation_type text CHECK (operation_type IS NULL OR operation_type IN ('form_create', 'form_edit', 'form_revise')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bucket IS NOT NULL),
  CHECK (entry_type <> 'ai_consumption' OR credits < 0),
  CHECK (entry_type NOT IN ('daily_grant', 'monthly_grant') OR credits > 0),
  CHECK (entry_type <> 'ai_consumption' OR operation_key IS NOT NULL)
);

-- One allowance per bucket and period per user.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_grant_unique
  ON credit_ledger (user_id, entry_type, period_key)
  WHERE entry_type IN ('daily_grant', 'monthly_grant');

-- One charge per bucket per logical operation. This is the database-level idempotency boundary.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_operation_unique
  ON credit_ledger (user_id, operation_key, bucket)
  WHERE entry_type = 'ai_consumption';

CREATE INDEX IF NOT EXISTS credit_ledger_balance_idx ON credit_ledger (user_id, bucket, period_key);
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, id);

-- Internal economics. Tokens are recorded for operators; users only ever see AI credits.
-- A row exists per logical operation (not per internal model call) and is updated in place if the
-- same operation key is retried, so the first attempt keeps its identity.
CREATE TABLE IF NOT EXISTS ai_operation (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  operation_key text NOT NULL CHECK (char_length(operation_key) BETWEEN 8 AND 64),
  operation_type text NOT NULL CHECK (operation_type IN ('form_create', 'form_edit', 'form_revise')),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 32),
  model text CHECK (model IS NULL OR char_length(model) <= 120),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'no_result')),
  error_category text CHECK (error_category IS NULL OR char_length(error_category) <= 40),
  -- 0 for failed operations and for clarification/unsupported results; never negative.
  credit_cost integer NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_key)
);

CREATE INDEX IF NOT EXISTS ai_operation_user_idx ON ai_operation (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_outcome_idx ON ai_operation (outcome, error_category);
