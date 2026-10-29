-- Phase: the Release Manager and the public changelog.
--
-- Additive and non-destructive. Four new tables and one seed set; no existing table is altered and
-- no existing row is touched. The existing changelog entries become releases so that every release
-- has a stable slug, a permanent URL and a publication date. The same entries are bundled with the
-- site (src/content/changelog.ts) as the offline fallback; a test keeps the two in step.
--
-- Rollback: DROP TABLE release_webhook_event, release_checklist_item, release_audit,
-- release_source, release; — nothing outside the Release Manager reads these tables, and the
-- public changelog falls back to the bundled notes.

CREATE TABLE IF NOT EXISTS release (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  -- The permanent public URL. Frozen once the release is published; the service enforces that.
  slug text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 3 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 140),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 320),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
  categories text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'awaiting_deployment', 'published', 'cancelled')),
  -- The date the reader sees. Set by an operator, not by a clock.
  release_date date,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_image_url text,
  share_text text CHECK (share_text IS NULL OR char_length(share_text) <= 600),
  author_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  author_name text,
  author_email text,
  approved_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  approved_at timestamptz,
  published_at timestamptz,
  published_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_status_idx ON release (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS release_published_idx ON release (COALESCE(release_date, published_at) DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS release_author_idx ON release (author_user_id);

-- Where a release came from: a pull request, a commit, a GitHub release or a deployment.
-- GitHub metadata is a snapshot of what the API returned at the time; it is never a secret and
-- never a credential.
CREATE TABLE IF NOT EXISTS release_source (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  release_id text NOT NULL REFERENCES release(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pull_request', 'commit', 'release', 'deployment')),
  provider text NOT NULL CHECK (provider IN ('github', 'manual')),
  external_id text,
  url text,
  title text,
  detail text,
  labels text[] NOT NULL DEFAULT '{}',
  state text,
  deployment_state text,
  deployment_environment text,
  deployment_ref text,
  deployment_sha text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_source_release_idx ON release_source (release_id);
CREATE INDEX IF NOT EXISTS release_source_external_idx ON release_source (provider, kind, external_id);

-- The administrative audit trail. Append-only from the application's point of view: the store has
-- no update or delete path for this table.
CREATE TABLE IF NOT EXISTS release_audit (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  release_id text NOT NULL REFERENCES release(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  actor_name text,
  actor_email text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_audit_release_idx ON release_audit (release_id, created_at DESC);

-- The administrator's answers to the manual checklist items. Automatic items are computed from
-- real state and are not stored; an explicit "not applicable" override is.
CREATE TABLE IF NOT EXISTS release_checklist_item (
  release_id text NOT NULL REFERENCES release(id) ON DELETE CASCADE,
  key text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirmed', 'unconfirmed', 'not_applicable')),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  PRIMARY KEY (release_id, key)
);

-- GitHub webhook deliveries already handled. The delivery id is the idempotency key: a repeat
-- delivery is acknowledged and ignored instead of being applied twice.
CREATE TABLE IF NOT EXISTS release_webhook_event (
  delivery_id text PRIMARY KEY CHECK (char_length(delivery_id) BETWEEN 1 AND 128),
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- The shipped releases that predate the Release Manager. These are verified history, not a
-- forecast, and each one is given a permanent slug so it can be linked and shared.
INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, published_at, created_at, updated_at)
VALUES
(
  'rel_launch_2026_10_01', 'launch', 'Launch',
  'Intake opens: create and edit Google Forms from a description, with daily free credits for everyone.',
  $body$## What changed
Intake opened to the public. You describe the form you need in plain English, Intake comes back with a full list of questions, answer types and required flags, and one confirmation creates the form in the Google account you connected.

## Why it matters
Building a form no longer means opening an editor and typing every question, every choice and every required toggle by hand. The review step stays in front of it: nothing is created until you approve the proposal.

## How to use it
Sign up, connect Google, and describe the form you want from the home screen. Your first form takes one sentence and one click.

## Limitations and availability
Google Forms was the only provider at launch. The Free plan includes 20 credits a day, refreshed at 00:00 UTC, and no card is required.$body$,
  ARRAY['feature'], 'published', DATE '2026-10-01',
  '[{"label":"How Intake works","url":"/guides"},{"label":"Pricing","url":"/pricing"}]'::jsonb,
  TIMESTAMPTZ '2026-10-01T00:00:00Z', TIMESTAMPTZ '2026-10-01T00:00:00Z', TIMESTAMPTZ '2026-10-01T00:00:00Z'
),
(
  'rel_welcome_2026_10_06', 'welcome-mail', 'Welcome mail',
  'Every new signup gets a personal welcome from Daniel, with the shipping cadence spelled out.',
  $body$## What changed
New accounts receive a welcome email that explains what Intake does, what is shipping next, and how to get their first form made. It is written and sent by a person rather than generated from a template.

## Why it matters
A new account starts with a decision to make: connect a provider, or write a description first. The welcome mail answers the question that otherwise sits unanswered in a confirmation screen.

## How to use it
Sign up with an email address and the message arrives with your account. It links straight to the workspace.

## Limitations and availability
Account and security messages always arrive. This release covers the welcome message only — optional product updates are a separate, opt-in list.$body$,
  ARRAY['improvement'], 'published', DATE '2026-10-06',
  '[{"label":"Privacy","url":"/privacy"}]'::jsonb,
  TIMESTAMPTZ '2026-10-06T00:00:00Z', TIMESTAMPTZ '2026-10-06T00:00:00Z', TIMESTAMPTZ '2026-10-06T00:00:00Z'
),
(
  'rel_analytics_2026_10_12', 'traffic-analytics', 'Traffic analytics',
  'Anonymous pageview and click analytics on the marketing site, with country reach that never touches IP addresses.',
  $body$## What changed
The marketing site now records which pages are read and which calls to action are pressed. The record is deliberately thin: the page path, the button label, the referring site, the browser time zone and any campaign tags. No IP address, no user agent, no cookie, no identifier.

## Why it matters
Country reach is the one thing a small team genuinely needs from traffic data, and it can be had without keeping anything about the person who asked. Time zone is enough to place a visit roughly; it is not enough to identify one.

## How to use it
Nothing to do. If your browser sends a Do Not Track header, nothing is recorded at all.

## Limitations and availability
The counts are aggregates. Intake does not and will not report unique visitors, sessions or retention, because it cannot compute them honestly from the data it keeps.$body$,
  ARRAY['feature'], 'published', DATE '2026-10-12',
  '[{"label":"Privacy","url":"/privacy"}]'::jsonb,
  TIMESTAMPTZ '2026-10-12T00:00:00Z', TIMESTAMPTZ '2026-10-12T00:00:00Z', TIMESTAMPTZ '2026-10-12T00:00:00Z'
),
(
  'rel_signup_2026_10_24', 'sign-up-is-open', 'Sign-up is open',
  'No more list to join: create an Intake account, connect a provider and build the first form in the same sitting. Free plan, 20 credits a day, no card.',
  $body$## What changed
The waiting list is gone. An account can be created, a provider connected and the first form described without leaving the browser tab, and the workspace is where the account lands.

## Why it matters
Intake used to ask for an email address before it could show any value. Now the first form is one sentence away from a real account, with the Free plan already running.

## How to use it
Create an account, connect Google or Typeform, and describe the form. Daily credits start immediately and refresh at 00:00 UTC.

## Limitations and availability
The Free plan includes 20 credits a day. Pro is not on sale yet; the pricing page says so plainly.$body$,
  ARRAY['feature'], 'published', DATE '2026-10-24',
  '[{"label":"Pricing","url":"/pricing"},{"label":"Guides","url":"/guides"}]'::jsonb,
  TIMESTAMPTZ '2026-10-24T00:00:00Z', TIMESTAMPTZ '2026-10-24T00:00:00Z', TIMESTAMPTZ '2026-10-24T00:00:00Z'
),
(
  'rel_typeform_2026_10_24', 'typeform-joins-google-forms', 'Typeform joins Google Forms',
  'Describe a form once and create it in Google Forms or Typeform, with the same review step before anything is created. The workspace was rebuilt around a single composer, and Typeform links can be imported into your library.',
  $body$## What changed
Intake can now write to Typeform as well as Google Forms. You pick the target when you describe the form, and the same approval-first composer handles both. Existing Typeform links can be imported into the library so they sit next to everything else you have made.

## Why it matters
The provider is a choice, not a migration. A team that lives in Typeform can keep its Typeform and still get the proposal-then-approve workflow, and a team that uses both can move between them without learning two products.

## How to use it
Connect Typeform, describe the form, and choose Typeform as the target. The proposal appears first, exactly as it does for Google Forms.

## Limitations and availability
Creating and importing work today. Editing a Typeform in place is not available yet — Google Forms can still be edited in place — and the workspace says so rather than implying otherwise.$body$,
  ARRAY['feature'], 'published', DATE '2026-10-24',
  '[{"label":"Trust and permissions","url":"/trust"},{"label":"Pricing","url":"/pricing"}]'::jsonb,
  TIMESTAMPTZ '2026-10-24T00:00:00Z', TIMESTAMPTZ '2026-10-24T00:00:00Z', TIMESTAMPTZ '2026-10-24T00:00:00Z'
),
(
  'rel_pages_2026_10_29', 'every-release-has-a-page', 'Every release now has its own page',
  'The changelog is no longer one long list: every release has a permanent page you can link to, share and keep.',
  $body$## What changed
Each release now has its own address — a permanent link that does not change when the index grows. The page carries the publication date, the categories, the full notes, the links that go with the release, and the social preview a link needs to look right when it is shared. Older entries were given the same pages, so every release listed here can be linked directly.

## Why it matters
A list can only be read in place. A page can be sent to someone, posted in a community, quoted in a release note, or bookmarked for later, and it keeps working when the next release arrives.

## How to use it
Open the changelog, pick a release, and copy its link. Every release page has a copy button for exactly this.

## Limitations and availability
Only published releases are public. Drafts, releases waiting for review and cancelled releases are never listed, never linked and never shareable.$body$,
  ARRAY['improvement'], 'published', DATE '2026-10-29',
  '[{"label":"Changelog","url":"/changelog"}]'::jsonb,
  TIMESTAMPTZ '2026-10-29T00:00:00Z', TIMESTAMPTZ '2026-10-29T00:00:00Z', TIMESTAMPTZ '2026-10-29T00:00:00Z'
)
ON CONFLICT (slug) DO NOTHING;
