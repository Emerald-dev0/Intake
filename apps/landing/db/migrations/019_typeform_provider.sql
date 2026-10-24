-- Typeform becomes a first-class creation target beside Google Forms.
--
-- Story so far: 001 only allowed the providers Intake could authorize (google, microsoft), 002 only
-- recorded Google/Microsoft forms, and 003 only stored Google drafts. The Typeform OAuth connection,
-- Create API adapter and planner already live in server/forms/providers/typeform and
-- server/providers/registry; without this migration PostgreSQL would reject the first Typeform
-- connection or draft even though the application supports it.
--
-- Widening a CHECK is additive: no row is rewritten, deleted, or re-validated against a narrower
-- rule, and no column, table, or index changes shape. Microsoft remains connectable and remains a
-- non-target: it has no supported Forms creation API, and `form_edit_draft` stays Google-only
-- because Intake does not claim Typeform editing.

-- Connections and in-flight OAuth transactions may belong to Typeform.
ALTER TABLE provider_connection DROP CONSTRAINT IF EXISTS provider_connection_provider_check;
ALTER TABLE provider_connection ADD CONSTRAINT provider_connection_provider_check
  CHECK (provider IN ('google', 'microsoft', 'typeform'));

ALTER TABLE provider_oauth_transaction DROP CONSTRAINT IF EXISTS provider_oauth_transaction_provider_check;
ALTER TABLE provider_oauth_transaction ADD CONSTRAINT provider_oauth_transaction_provider_check
  CHECK (provider IN ('google', 'microsoft', 'typeform'));

-- Forms Intake created or imported may live in Typeform. Microsoft stays listed so an existing row
-- or a future adapter never needs another constraint change; it is unreachable today because the
-- Microsoft provider slot refuses creation.
ALTER TABLE form DROP CONSTRAINT IF EXISTS form_provider_check;
ALTER TABLE form ADD CONSTRAINT form_provider_check
  CHECK (provider IN ('google', 'microsoft', 'typeform'));

-- A review draft is bound to the provider it will be created in. The provider is fixed when the
-- draft is created (server-side, from a validated request) and is never taken from the model or the
-- browser at confirmation time.
ALTER TABLE form_draft DROP CONSTRAINT IF EXISTS form_draft_provider_check;
ALTER TABLE form_draft ADD CONSTRAINT form_draft_provider_check
  CHECK (provider IN ('google', 'typeform'));
