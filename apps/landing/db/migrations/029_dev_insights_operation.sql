-- Phase: AI summaries of developer form responses.
--
-- A response summary is an AI operation like any other, so it is charged through the same credit
-- service, the same buckets and the same idempotency rules. The only thing that changes here is
-- the name of the operation, which the two CHECK constraints below had to learn about.
--
-- Nothing else is touched: no bucket, no plan, no price and no ledger row changes shape.
--
-- Rollback: the constraints are restored to their previous lists. Rows already written with
-- 'dev_insights' would then be refused by the constraint, so roll this back only if you are also
-- removing those rows:
--   DELETE FROM credit_ledger WHERE operation_type = 'dev_insights';
--   DELETE FROM ai_operation WHERE operation_type = 'dev_insights';

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_operation_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_operation_type_check
  CHECK (operation_type IS NULL OR operation_type IN (
    'form_create', 'form_edit', 'form_revise',
    'subscription_grant', 'credit_purchase', 'promotion_grant',
    'dev_insights'
  ));

ALTER TABLE ai_operation DROP CONSTRAINT IF EXISTS ai_operation_operation_type_check;
ALTER TABLE ai_operation ADD CONSTRAINT ai_operation_operation_type_check
  CHECK (operation_type IN ('form_create', 'form_edit', 'form_revise', 'dev_insights'));
