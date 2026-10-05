-- Historical migration id retained for migration-history compatibility.
--
-- The first version created an ai_operation telemetry table with request_id/started_at fields.
-- `007_ai_credits.sql` now owns the logical AI-operation table. Its migration preflights that legacy
-- table, and `008_ai_operation_compat.sql` preserves and maps any historical rows. Running this
-- filename on a fresh or already-upgraded database must therefore be a no-op.
SELECT 1;
