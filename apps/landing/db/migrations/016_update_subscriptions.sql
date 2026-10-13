-- Update subscriptions (Pro waitlist and product-update list).
--
-- A visitor writes their email address; Intake writes nothing else. No account,
-- no tracking, no marketing beyond the one list they joined. Unsubscribe is a
-- single DELETE away, and the address is stored lowercased so casing can never
-- create a second row for the same mailbox.

CREATE TABLE IF NOT EXISTS update_subscription (
  id text PRIMARY KEY,
  email text NOT NULL CHECK (char_length(email) >= 3 AND char_length(email) <= 320),
  interest text NOT NULL DEFAULT 'updates' CHECK (interest IN ('pro', 'updates')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS update_subscription_email_interest_idx
  ON update_subscription (email, interest);
