-- Phase: usage metering for the developer workspace.
--
-- One row per project per day, with the counters an operator can reconcile: answers accepted,
-- requests rejected, and the bytes of answers stored. The counts are ours to reconcile against
-- what Render, Neon, Vercel and the model provider show; the table exists so the developer can
-- see their own project without asking.
--
-- There is no address, no user agent and no free-form note in this table: it is counters.
--
-- Rollback: DROP TABLE dev_usage_daily; — the counters can be rebuilt from the submissions.

CREATE TABLE IF NOT EXISTS dev_usage_daily (
  project_id text NOT NULL REFERENCES dev_project(id) ON DELETE CASCADE,
  -- The UTC day the usage belongs to.
  day date NOT NULL,
  accepted integer NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  bytes integer NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  PRIMARY KEY (project_id, day)
);

CREATE INDEX IF NOT EXISTS dev_usage_daily_day_idx ON dev_usage_daily (day DESC);
