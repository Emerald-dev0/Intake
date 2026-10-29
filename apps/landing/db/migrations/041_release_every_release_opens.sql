-- Phase: the changelog answers at every address a release is served from.
--
-- Each release is written out as a document of its own, so a crawler and a link preview can read
-- it without running the site. That document is stored at an address ending in index.html, and a
-- reader who arrived there was told the page did not exist — the site had no route for the two
-- addresses together.
--
-- The site now recognises that address and takes the reader to the permanent one, so the entry
-- is seeded here as well: the release is shipped, and the changelog says so.
--
-- Rollback: DELETE FROM release WHERE slug = 'every-release-opens'; — the entry disappears. The
-- other releases are untouched, and the notes bundled with the site still carry this entry.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_every_release_opens', 'every-release-opens', 'Every release opens',
  'A release served from the address it is stored at was met with a page saying it did not exist. Every release now opens at that address, and at the permanent one it always had.',
  $notes$## The page that said it was not there
A release has one permanent address: /changelog/<slug>. It is in the sitemap, it is what the share card points at, and it is what a link from the changelog, from a search engine or from a colleague sends you to.
Each release is also written out as a document of its own, so that a crawler and a link preview can read the release without running the site. That document is stored with an index.html on the end of its address, and some addresses served it from there. The document itself was right: the title was the release title, the description was the release description, and the whole release was written into it.
What the site did with that address was the problem. It knew the permanent address, and it knew the address with the file name on the end, but not the two together — so the reader was told the page did not exist. The release was there the whole time.
## What changed
The site now knows the address a release is served from as well as the address it is written under. Opening a release at that address shows the release; opening the changelog index at that address shows the changelog.
The address in the address bar settles on the permanent one, so a reader who arrives by the other address ends up somewhere they can share, and the canonical link and the share card still point at the same place as before.
## What did not change
Every release keeps its permanent address, its title, its date, its notes and its place in the order. The sitemap is unchanged. Nothing was rewritten and no release was republished.$notes$,
  ARRAY['fix'], 'published', DATE '2026-10-29',
  '[{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['A release opened at the address it is served from now shows the release — not a page saying it does not exist.', 'The changelog index opens at that address too, rather than looking for a release called index.html.', 'The permanent address of every release is unchanged, and it is the one the address bar settles on.', 'No release notes, titles or dates changed. The same history, with the pages open.'],
  'For anyone who followed a link to a release and was told the page was not there.',
  TIMESTAMPTZ '2026-10-29T18:30:00.000Z', TIMESTAMPTZ '2026-10-29T18:30:00.000Z', TIMESTAMPTZ '2026-10-29T18:30:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
