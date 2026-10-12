-- Phase 20 follow-up — Approximate country reach without IP addresses.
--
-- Additive and non-destructive. Two columns on the existing aggregate-fuel
-- table: a 2-letter country code (preferred from the edge geo headers the
-- platform attaches, otherwise approximated from the browser timezone) and
-- the validated IANA zone itself so the approximation stays auditable.
-- Still no IPs, user agents, cookies or identifiers: per-visitor counting
-- remains structurally impossible, and unknown stays empty, never guessed.

ALTER TABLE site_events ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '' CHECK (char_length(country) <= 2);
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT '' CHECK (char_length(time_zone) <= 60);
CREATE INDEX IF NOT EXISTS site_events_country_day_idx ON site_events (country, day);
