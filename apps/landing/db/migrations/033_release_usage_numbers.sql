-- Phase: the usage counters.
--
-- A feature developers can use is a public announcement, so it ships with a changelog entry like
-- everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'your-usage-numbers'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_your_usage_numbers', 'your-usage-numbers', 'What your forms did, in three numbers',
  'Every project now reports the answers it accepted, the requests it refused and the bytes it stored — over the last thirty days, per project and in total.',
  $notes$## Three numbers
The workspace now reports what your projects did: how many answers were accepted, how many requests were refused, and how much was stored. Thirty days at a time, per project and in total.
## Refused counts as refused
A request that did not become an answer is counted as refused — a bad answer, a question the form does not have, a value of the wrong shape. That is the number you want when something is being sent at you, and it is counted only for a project that exists, so a request for an address that does not is not quietly put on somebody else.
## Where the numbers come from
They are counted by Intake, as the answers arrive. An operator can compare them with what the hosting, the database and the model provider report, and the two should agree — which is the point of counting them here rather than estimating them somewhere else.
They are deliberately plain: a number of answers, a number of refusals, a number of bytes. No addresses, no user agents, no notes.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['Three counters, counted as they happen: answers accepted, requests refused, bytes stored.', 'Per project and in total, over thirty days.', 'The same numbers an operator sees, so the two can be compared rather than believed.'],
  'For developers who want to know what a form is doing without reading every answer.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
