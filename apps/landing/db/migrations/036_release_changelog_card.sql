-- Phase: the changelog card.
--
-- The changelog is now in the navigation bar and every release draws a share card of its own, so
-- a pasted link shows the release rather than the home page. That is a change a reader can see,
-- so it ships with a changelog entry like everything else.
--
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'the-changelog-has-a-card'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_the_changelog_has_a_card', 'the-changelog-has-a-card', 'The changelog, where you look for it',
  'The changelog is in the navigation bar now, and every release has a card of its own — so a link you paste shows the release instead of the homepage.',
  $notes$## Where the changelog went
The changelog was in the footer, which is where a link goes when nobody is thinking about it. It is now in the navigation bar, between the questions people ask and the developers page, because the people who want to know what shipped are the people who will look for it there.
## A card for every release
When you paste a link to a release into a chat, the preview used to be a picture of the home page. That tells a reader nothing about what they are about to read.
Every release now draws a card of its own: the title of the release, the day it shipped, and the first lines of what it says, in the same colours and the same shape as the rest of the site. It is drawn from the release itself, so a release that is corrected gets a corrected card — and a release published tomorrow gets one too, without the site being rebuilt.
The changelog itself has a card as well, carrying the newest release.
## What a crawler sees
Every changelog address now has a document of its own, written at build time: the title of the release, its description, its permanent address, the card, and the notes themselves in readable HTML.
That matters for more than search engines. A link preview is made from the document, before any of the page runs, so without this the preview had nothing to show. Now the preview, the crawler and the reader all get the same release.
The permanent addresses do not change. A release you have linked to before still resolves to the same place, with the same card.$notes$,
  ARRAY['improvement'], 'published', DATE '2026-10-29',
  '[{"label":"Changelog","url":"/changelog"},{"label":"Developers","url":"/developers"}]'::jsonb,
  ARRAY['Changelog sits in the top navigation, one click from the home page.', 'Every release draws a card from its own title, date and summary — the preview shows what was written there.', 'Each changelog address has a document of its own, with the title, the notes and the card in it, so a crawler reads the release rather than a stub.'],
  'For readers who follow what Intake ships, and for anybody pasting a link to a release.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
