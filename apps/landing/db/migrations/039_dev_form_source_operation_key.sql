-- The AI operation that wrote a form.
--
-- A developer can write the questions of a hosted form from one sentence. That is one operation:
-- the model is called once, the credits are charged once, and the form is created once. A browser
-- that retries — a dropped connection, a double tap — sends the same operation key, and the
-- server hands back the form it already made instead of making a second copy of it.
--
-- The column is nullable and defaults to null: every form made by hand, and every form made
-- before today, keeps working exactly as it did.
--
-- Rollback: ALTER TABLE dev_form DROP COLUMN source_operation_key; — the forms stay, they simply
-- stop remembering which operation wrote them.

ALTER TABLE dev_form
  ADD COLUMN IF NOT EXISTS source_operation_key text;

CREATE INDEX IF NOT EXISTS dev_form_source_operation_idx
  ON dev_form (source_operation_key)
  WHERE source_operation_key IS NOT NULL;
