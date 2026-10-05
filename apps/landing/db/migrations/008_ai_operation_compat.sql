-- Reconcile the short-lived Phase 12 telemetry schema with the Phase 11 credit-ledger schema.
-- This is safe whether 007_ai_credits ran before or after the legacy table was present. The old
-- table contains operational metadata only; it is retained under an explicit archive name after its
-- rows are mapped into the canonical logical-operation table. No prompts, responses or credentials
-- are copied.

DO $$
BEGIN
  IF to_regclass('public.ai_operation') IS NOT NULL
     AND NOT (
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_operation' AND column_name = 'operation_key')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_operation' AND column_name = 'created_at')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_operation' AND column_name = 'credit_cost')
     ) THEN
    IF to_regclass('public.ai_operation_legacy_phase12') IS NOT NULL THEN
      RAISE EXCEPTION 'Both legacy ai_operation and ai_operation_legacy_phase12 exist; reconcile them before migration.';
    END IF;
    ALTER TABLE public.ai_operation RENAME TO ai_operation_legacy_phase12;
  END IF;
END $$;

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
  credit_cost integer NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_key)
);

CREATE INDEX IF NOT EXISTS ai_operation_user_idx ON ai_operation (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_outcome_idx ON ai_operation (outcome, error_category);

DO $$
BEGIN
  IF to_regclass('public.ai_operation_legacy_phase12') IS NOT NULL THEN
    WITH source AS (
      SELECT legacy.*,
             md5('intake-ai-operation:' || COALESCE(legacy.id::text, legacy.request_id)) AS stable_id
      FROM public.ai_operation_legacy_phase12 AS legacy
    )
    INSERT INTO ai_operation (
      id, user_id, operation_key, operation_type, provider, model,
      input_tokens, output_tokens, total_tokens, latency_ms,
      outcome, error_category, credit_cost, created_at
    )
    SELECT
      (substring(stable_id FROM 1 FOR 8) || '-' || substring(stable_id FROM 9 FOR 4) || '-' ||
       substring(stable_id FROM 13 FOR 4) || '-' || substring(stable_id FROM 17 FOR 4) || '-' ||
       substring(stable_id FROM 21 FOR 12))::uuid,
      user_id,
      'legacy_' || md5(COALESCE(request_id, id::text)),
      CASE
        WHEN operation = 'form_edit_interpretation' AND route = '/api/forms/edit/revise' THEN 'form_revise'
        WHEN operation = 'form_edit_interpretation' THEN 'form_edit'
        WHEN route = '/api/forms/revise' THEN 'form_revise'
        ELSE 'form_create'
      END,
      COALESCE(NULLIF(left(provider, 32), ''), 'legacy'),
      NULLIF(left(model, 120), ''),
      CASE WHEN input_tokens BETWEEN 0 AND 2147483647 THEN input_tokens::integer ELSE NULL END,
      CASE WHEN output_tokens BETWEEN 0 AND 2147483647 THEN output_tokens::integer ELSE NULL END,
      CASE
        WHEN input_tokens IS NULL AND output_tokens IS NULL THEN NULL
        WHEN COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) <= 2147483647
          THEN (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))::integer
        ELSE NULL
      END,
      latency_ms,
      status,
      NULLIF(left(failure_code, 40), ''),
      0,
      COALESCE(completed_at, started_at, now())
    FROM source
    ON CONFLICT (user_id, operation_key) DO NOTHING;
  END IF;
END $$;
