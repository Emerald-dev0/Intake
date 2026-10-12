-- Phase 19 — Admin-editable billing settings.
--
-- Additive and non-destructive. A single-row table holds the plan allowances
-- and prices an administrator can change from the admin dashboard without a
-- redeploy. The code constants in `server/billing/plans.ts` (mirrored for
-- display in `src/lib/plans.ts`) remain the defaults: when this table has no
-- row — fresh databases, pre-dashboard states, tests — the server behaves
-- exactly as the constants describe.
--
-- Whether paid billing is actually open stays a code flag
-- (`PAID_BILLING_ENABLED`), never a dashboard edit: opening checkout is a
-- launch decision, not a settings change. These values only take effect for
-- display, grants and checkout amounts; they cannot open paid billing early.
--
-- Editable here: free/pro daily allowances, Pro monthly/annual prices,
-- credit-pack prices. Pack credit amounts and plan structure are fixed.

CREATE TABLE IF NOT EXISTS billing_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  free_daily_credits integer NOT NULL DEFAULT 20 CHECK (free_daily_credits BETWEEN 1 AND 500),
  pro_daily_credits integer NOT NULL DEFAULT 20 CHECK (pro_daily_credits BETWEEN 1 AND 500),
  pro_monthly_cents integer NOT NULL DEFAULT 799 CHECK (pro_monthly_cents BETWEEN 0 AND 99900),
  pro_annual_cents integer NOT NULL DEFAULT 6900 CHECK (pro_annual_cents BETWEEN 0 AND 99900),
  pack_starter_cents integer NOT NULL DEFAULT 199 CHECK (pack_starter_cents BETWEEN 0 AND 99900),
  pack_standard_cents integer NOT NULL DEFAULT 599 CHECK (pack_standard_cents BETWEEN 0 AND 99900),
  pack_power_cents integer NOT NULL DEFAULT 1299 CHECK (pack_power_cents BETWEEN 0 AND 99900),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text CHECK (updated_by IS NULL OR char_length(updated_by) <= 320)
);

-- Seed the defaults row so the dashboard always has something to show.
-- An admin edit updates this row in place; it is never deleted.
INSERT INTO billing_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
