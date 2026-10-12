-- Phase 21 — Record whether a country code is edge-confirmed.
--
-- Additive and non-destructive. `site_events.country` mixes two provenances:
-- edge geo headers (IP-based, precise) and browser-timezone approximation.
-- The summary derived "precise" from `time_zone = ''`, which mislabels rows
-- that carry both a header code and a timezone. This column stores the
-- provenance truthfully at insert time instead of guessing it at read time.
-- Existing rows keep the default (unconfirmed); nothing is backfilled as
-- precise because that history cannot be reconstructed honestly.

ALTER TABLE site_events ADD COLUMN IF NOT EXISTS country_precise boolean NOT NULL DEFAULT false;
