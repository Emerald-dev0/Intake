-- Phase: the Developers page.
--
-- A public page is a public announcement, so it ships with a changelog entry like everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'intake-for-developers-page'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_developers_2026_10_29', 'intake-for-developers-page', 'The developer page, and what it does not promise',
  'There is now a Developers page, and every capability on it says whether it ships today, is being built, or is not promised.',
  $notes$## A page before the product
Intake for Developers is being built. Rather than keep that quiet, the developer page says so on its face: every capability carries a state, and the states are shipping, being built, and not promised.
Webhooks are not promised. An SDK is not promised. Both are plausible and neither exists, so both are written down as things you should not plan around.
## What the page covers
What a form costs when you host it yourself — the renderer, the validation, the storage, the spam control, the exports and the lifecycle — and what Intake for Developers takes off that list.
How the embed works: a permanent URL per form, a snippet to paste, theme tokens for colour, background, text, border, typeface and corner radius, and light, dark and system themes including a transparent background.
And the part that is usually skipped: an iframe pointing at another origin cannot read your page’s stylesheet, your variables or your fonts. That is a browser rule rather than a setting, which is why the theme is configuration and not inheritance.
## The credits do not change
AI summaries of responses run on Intake’s existing 20 daily credits. There is no second wallet for developers, no separate currency, and no conversion rate to memorise. The cost is shown before a summary runs, and a summary that fails does not spend anything.
## How we will keep it honest
The status of each capability is one line in one file, and every change to it ships with a changelog entry — this one included. If a capability starts working, this page says so the day it works, not the day it is convenient.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['One board, three states: shipping, being built, and not promised. Nothing is left vague.', 'What a cross-origin embed can and cannot inherit is written down, plainly.', 'One email when developer forms open. Nothing else, and no list you did not ask for.'],
  'For developers deciding whether to wait for Intake to host their forms.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
