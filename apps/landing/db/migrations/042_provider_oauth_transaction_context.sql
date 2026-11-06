-- What an in-flight authorization asked for, and where the person is sent afterwards.
--
-- A person who already connected Google Forms can later allow one more permission: reading the
-- responses to their forms. Google merges that permission into the existing grant rather than
-- replacing it, so the grant only ever grows.
--
-- Two pieces of context have to survive the round trip through Google's consent screen, and
-- neither belongs in the URL:
--
--   requested_scopes — the scopes this authorization asked for. Google's answer is what was
--                      actually granted, and only that answer counts, but when a token response
--                      carries no scope at all the request is the only record of what was asked
--                      for. Without it, an incremental grant would silently record the older,
--                      smaller set of permissions instead of the larger one.
--   return_to       — the page the person came from, so they land back where they were instead of
--                      on a generic screen. Only a path on this site is ever stored.
--
-- Both columns are nullable and default to null. A transaction created before this migration
-- simply has neither, and the callback falls back to the provider's base scopes and the default
-- landing page. No connection, grant or scope is changed by this migration.
--
-- Rollback: ALTER TABLE provider_oauth_transaction DROP COLUMN requested_scopes, DROP COLUMN
-- return_to; — in-flight authorizations finish as they did before, and no grant is affected.

ALTER TABLE provider_oauth_transaction
  ADD COLUMN IF NOT EXISTS requested_scopes text;

ALTER TABLE provider_oauth_transaction
  ADD COLUMN IF NOT EXISTS return_to text;
