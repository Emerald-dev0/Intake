-- Phase 18 — Billing, subscriptions, credit packs and payment tracking.
--
-- Additive and non-destructive. Preserves all existing credit ledger data and
-- extends the system to support subscriptions, payments and purchased credits.
--
-- Tables:
--   billing_customer          maps Intake users to payment-provider customers
--   billing_subscription      subscription lifecycle (plan, status, periods, cancellation)
--   billing_payment           every payment attempt and its outcome
--   billing_credit_purchase   credit-pack purchases with grant tracking
--   billing_webhook_event     idempotency for provider webhooks
--   billing_reminder          idempotency for scheduled billing reminders
--
-- Credit ledger extensions:
--   - New entry_type values: 'subscription_grant', 'credit_purchase', 'promotion_grant'
--   - New bucket value: 'purchased' (for credit-pack credits)
--   - New operation_type values: 'subscription_grant', 'credit_purchase'
--
-- Compatibility:
--   Existing 'monthly' bucket and 'monthly_grant' entry_type remain valid.
--   The 'subscription' bucket is introduced as the primary mechanism for Pro credits.
--   Migration preserves all existing data; no rows are deleted or modified.

-- ── Extend credit_ledger constraints ───────────────────────────────────────────────────────────

-- Drop and recreate the entry_type CHECK to include new billing entry types.
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_entry_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_entry_type_check
  CHECK (entry_type IN (
    'daily_grant', 'monthly_grant', 'subscription_grant',
    'ai_consumption', 'manual_adjustment', 'expiration',
    'credit_purchase', 'promotion_grant'
  ));

-- Drop and recreate the bucket CHECK to include the 'purchased' bucket.
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_bucket_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_bucket_check
  CHECK (bucket IS NULL OR bucket IN ('daily', 'monthly', 'subscription', 'purchased', 'promotion'));

-- Drop and recreate the operation_type CHECK to include billing operation types.
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_operation_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_operation_type_check
  CHECK (operation_type IS NULL OR operation_type IN (
    'form_create', 'form_edit', 'form_revise',
    'subscription_grant', 'credit_purchase', 'promotion_grant'
  ));

-- Extend the grant unique index to cover subscription_grant entries.
-- (subscription_grant is unique per user per period, like monthly_grant)
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_subscription_grant_unique
  ON credit_ledger (user_id, entry_type, period_key)
  WHERE entry_type IN ('subscription_grant');

-- Index for purchased-credit consumption tracking.
CREATE INDEX IF NOT EXISTS credit_ledger_purchased_idx
  ON credit_ledger (user_id, bucket)
  WHERE bucket = 'purchased';

-- ── Billing tables ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider_customer_id text CHECK (provider_customer_id IS NULL OR char_length(provider_customer_id) <= 255),
  provider text NOT NULL DEFAULT 'bachs' CHECK (char_length(provider) BETWEEN 2 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS billing_customer_user_idx ON billing_customer (user_id);

CREATE TABLE IF NOT EXISTS billing_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('free', 'pro_monthly', 'pro_annual')),
  provider_subscription_id text CHECK (provider_subscription_id IS NULL OR char_length(provider_subscription_id) <= 255),
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN (
    'active', 'past_due', 'canceled', 'expired', 'incomplete', 'trialing'
  )),
  interval text NOT NULL CHECK (interval IN ('month', 'year')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);

CREATE INDEX IF NOT EXISTS billing_subscription_user_idx ON billing_subscription (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_subscription_provider_idx ON billing_subscription (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_subscription_status_idx ON billing_subscription (status);

CREATE TABLE IF NOT EXISTS billing_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  purpose text NOT NULL CHECK (purpose IN ('subscription', 'subscription_renewal', 'credit_pack')),
  provider text NOT NULL DEFAULT 'bachs' CHECK (char_length(provider) BETWEEN 2 AND 40),
  provider_transaction_id text CHECK (provider_transaction_id IS NULL OR char_length(provider_transaction_id) <= 255),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'canceled')),
  subscription_id uuid REFERENCES billing_subscription(id) ON DELETE SET NULL,
  credit_purchase_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_payment_user_idx ON billing_payment (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_payment_provider_txn_idx ON billing_payment (provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_payment_status_idx ON billing_payment (status);
CREATE INDEX IF NOT EXISTS billing_payment_purpose_idx ON billing_payment (purpose);

CREATE TABLE IF NOT EXISTS billing_credit_purchase (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  pack text NOT NULL CHECK (pack IN ('starter', 'standard', 'power')),
  credits integer NOT NULL CHECK (credits > 0),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  payment_id uuid REFERENCES billing_payment(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'failed', 'refunded')),
  granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_credit_purchase_user_idx ON billing_credit_purchase (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_credit_purchase_status_idx ON billing_credit_purchase (status);

-- Back-reference from billing_payment to billing_credit_purchase.
ALTER TABLE billing_payment
  ADD CONSTRAINT billing_payment_credit_purchase_fk
  FOREIGN KEY (credit_purchase_id) REFERENCES billing_credit_purchase(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS billing_webhook_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 2 AND 40),
  event_id text NOT NULL CHECK (char_length(event_id) BETWEEN 4 AND 255),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 2 AND 120),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS billing_webhook_event_provider_event_idx
  ON billing_webhook_event (provider, event_id);
CREATE INDEX IF NOT EXISTS billing_webhook_event_created_idx
  ON billing_webhook_event (created_at DESC);

-- Scheduled billing reminders: renewal, cancellation-ending, etc.
-- Idempotency: a reminder type for a user in a given period can only fire once.
CREATE TABLE IF NOT EXISTS billing_reminder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (char_length(reminder_type) BETWEEN 4 AND 80),
  period_key text NOT NULL CHECK (char_length(period_key) BETWEEN 4 AND 40),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reminder_type, period_key)
);

CREATE INDEX IF NOT EXISTS billing_reminder_user_idx ON billing_reminder (user_id, sent_at DESC);
