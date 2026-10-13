-- Durable welcome-mail outbox for the early-access list. Joining and enqueueing are the same
-- INSERT: a provider outage or process restart must never lose a successfully saved signup.
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS welcome_status text NOT NULL DEFAULT 'pending'
    CHECK (welcome_status IN ('pending', 'sending', 'accepted', 'suppressed', 'blocked')),
  ADD COLUMN IF NOT EXISTS welcome_attempts integer NOT NULL DEFAULT 0 CHECK (welcome_attempts >= 0),
  ADD COLUMN IF NOT EXISTS welcome_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS welcome_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_error_code text;

-- The old implementation did not normalize addresses. Merge case/whitespace duplicates while
-- retaining the oldest signup (and its business-event id), then enforce normalization in SQL.
DELETE FROM waitlist later USING waitlist earlier
WHERE lower(btrim(later.email)) = lower(btrim(earlier.email))
  AND (later.created_at, later.id) > (earlier.created_at, earlier.id);
UPDATE waitlist SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_normalized_email' AND conrelid = 'waitlist'::regclass) THEN
    ALTER TABLE waitlist ADD CONSTRAINT waitlist_normalized_email CHECK (email = lower(btrim(email)));
  END IF;
END $$;

-- The legacy "remove" helper replaced email with <uuid>_removed. Never mail or revive those rows.
UPDATE waitlist SET welcome_status = 'suppressed', welcome_error_code = 'legacy_removed'
WHERE email LIKE '%\_removed' ESCAPE '\' AND position('@' in email) = 0;

CREATE INDEX IF NOT EXISTS waitlist_welcome_due_idx
  ON waitlist (welcome_next_attempt_at, created_at)
  WHERE welcome_status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist (created_at DESC, id);
