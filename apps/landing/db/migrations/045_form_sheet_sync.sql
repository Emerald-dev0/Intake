-- Keeping a Google Form's responses in a Google Sheet, on a schedule.
--
-- Google gives no transaction that spans "append rows to a spreadsheet" and "record that we did".
-- A process can die between the two, and a naive retry then writes the same answers twice. The
-- design that survives that is in server/forms/sheets/sync.ts, and this schema is what it needs:
--
--   form_sheet_sync   one row per form, holding the destination, the cursor, the schedule and the
--                     last outcome. This is coordination state, not a copy of anybody's answers.
--   form_sheet_row    which response ids this sync has written, one row per id, with no contents.
--
-- The second table is a cache, not the source of truth. Every run reads the destination's own
-- Response ID column first and skips anything already there, so a write that landed but was never
-- recorded here is still not repeated. The table exists to make the common case one cheap check
-- rather than a full comparison, and it is deleted with the sync it belongs to.
--
-- Nothing here stores an answer, a respondent's email or an OAuth token. Deleting a form deletes
-- its sync row and every id in it; disabling a sync stops the schedule and leaves the spreadsheet
-- exactly as it is.
--
-- Rollback: DROP TABLE form_sheet_row; DROP TABLE form_sheet_sync; — no form, response or
-- spreadsheet is touched, and nothing else references either table.

CREATE TABLE IF NOT EXISTS form_sheet_sync (
  id text PRIMARY KEY,
  -- One destination per form in this phase. A unique constraint is also the concurrency guard:
  -- two tabs pressing "create a spreadsheet" cannot end up with two syncs racing each other.
  form_id text NOT NULL UNIQUE REFERENCES form(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL CHECK (char_length(spreadsheet_id) BETWEEN 20 AND 120),
  spreadsheet_url text CHECK (spreadsheet_url IS NULL OR char_length(spreadsheet_url) <= 512),
  -- Google's numeric tab id, which survives a rename; sheet_title is what it was last called.
  sheet_id integer NOT NULL CHECK (sheet_id >= 0),
  sheet_title text NOT NULL CHECK (char_length(sheet_title) BETWEEN 1 AND 200),
  -- The questions the header row was written for. If the form's questions change after data has
  -- been written, the columns no longer mean what they say, and the sync stops rather than
  -- silently mislabelling new answers.
  header_signature text NOT NULL CHECK (char_length(header_signature) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'syncing', 'up_to_date', 'delayed', 'failed', 'disabled')),
  enabled boolean NOT NULL DEFAULT true,
  -- The newest lastSubmittedTime that has been fully dealt with. Used as an inclusive lower bound
  -- for the next read, never as a unique key: two responses can share an instant.
  cursor_last_submitted timestamptz,
  synced_count integer NOT NULL DEFAULT 0 CHECK (synced_count >= 0),
  last_synced_at timestamptz,
  -- A code, never a provider message: 'permission_revoked', 'destination_unavailable',
  -- 'rate_limited', 'sheets_unavailable', 'questions_changed', 'form_unavailable'.
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 64),
  last_error_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  -- A lease. A worker that dies mid-run leaves a claim that expires, and the run_id fence stops a
  -- stale finish from overwriting a newer run's result.
  locked_until timestamptz,
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_sheet_sync_due_idx
  ON form_sheet_sync (next_sync_at)
  WHERE enabled AND status <> 'disabled';

CREATE INDEX IF NOT EXISTS form_sheet_sync_user_idx
  ON form_sheet_sync (user_id);

CREATE TABLE IF NOT EXISTS form_sheet_row (
  sync_id text NOT NULL REFERENCES form_sheet_sync(id) ON DELETE CASCADE,
  -- Google's response id. Nothing else about the response is kept: no answers, no email, no time.
  response_id text NOT NULL CHECK (char_length(response_id) BETWEEN 1 AND 256),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_id, response_id)
);
