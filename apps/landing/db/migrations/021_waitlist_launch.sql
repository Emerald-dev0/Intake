-- Migration: 021_waitlist_launch
--
-- Launch mail ("we are live") goes to people who joined the wait-list, which makes two things
-- non-negotiable that a signup confirmation never needed:
--
--   1. A working way off the list. `unsubscribed_at` is that, and it is permanent: nothing in the
--      product may clear it. The unsubscribe link carries an HMAC of the row id, so an address never
--      appears in a URL and a guessed link cannot remove somebody else.
--   2. A record of who already received which letter. The unique key makes a re-run of the sender a
--      no-op instead of a second copy in every inbox — the most embarrassing failure a launch has.
--
-- Additive: one nullable column, one new table. No row is rewritten.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

CREATE TABLE IF NOT EXISTS waitlist_launch_send (
  waitlist_id uuid NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  campaign text NOT NULL CHECK (campaign IN ('launch_announcement', 'launch_note')),
  delivery_id text,
  state text NOT NULL DEFAULT 'accepted' CHECK (state IN ('accepted', 'failed')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (waitlist_id, campaign)
);

-- The sender asks "who is still owed this campaign, oldest first", so this is the index it walks.
CREATE INDEX IF NOT EXISTS waitlist_launch_send_campaign_idx ON waitlist_launch_send (campaign, sent_at);
