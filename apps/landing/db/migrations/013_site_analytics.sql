-- Phase 20 — Privacy-first site analytics.
--
-- Additive and non-destructive. One append-only table records public-page
-- engagement so the admin dashboard can answer "where are visitors coming
-- from, how many visits, which pages, which buttons" without a third-party
-- tracker. Privacy is structural, not promised:
--   - no IP addresses, no user-agent strings, no query strings, no cookies;
--   - paths are allowlisted to public marketing routes (/ and /pricing);
--   - referrers are reduced to a hostname (never a full URL);
--   - UTM values are short free-text tags, length-capped;
--   - nothing here can identify or follow a person across visits.
-- Rows are aggregate fuel only; there is no per-visitor counting because
-- there is no visitor identifier to count by. "Visits" below means events.

CREATE TABLE IF NOT EXISTS site_events (
  id bigserial PRIMARY KEY,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pageview', 'click')),
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 200),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 120),
  referrer_host text NOT NULL DEFAULT '' CHECK (char_length(referrer_host) <= 120),
  utm_source text NOT NULL DEFAULT '' CHECK (char_length(utm_source) <= 60),
  utm_medium text NOT NULL DEFAULT '' CHECK (char_length(utm_medium) <= 60),
  utm_campaign text NOT NULL DEFAULT '' CHECK (char_length(utm_campaign) <= 60),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_events_day_idx ON site_events (day);
CREATE INDEX IF NOT EXISTS site_events_kind_day_idx ON site_events (kind, day);
