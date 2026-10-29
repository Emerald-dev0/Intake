-- Phase: the answer summary.
--
-- A feature developers can use is a public announcement, so it ships with a changelog entry like
-- everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'summarise-the-answers'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_summarise_the_answers', 'summarise-the-answers', 'What the answers sound like',
  'The answers to a hosted form can now be summarised — in three of the credits you already have, with the exact counts counted beside the interpretation.',
  $notes$## A summary, not a statistic
Press the button and Intake reads the answers and says what they sound like: the themes, the things people keep mentioning, the tone. It is labelled as an interpretation, because that is what it is.
The counts sit next to it and are exact, because they are counted from the rows rather than written by a model. Ask for a summary of two hundred answers and the table above it still says how many answers there were.
## It costs three credits, from the balance you have
A summary is an operation like any other: the same 20 daily credits, the same buckets, the same price list, the same rules about what happens when the balance runs out. There is no developer wallet and no developer currency, and the page shows the cost before you ask and the receipt after.
If the model does not answer, you pay nothing. The charge happens when there is a usable summary, not when the request is made.
## Asking again is free
The key of the operation is worked out from the answers themselves, so asking for a summary of the same answers twice does not take a second three credits — it says that you have already paid for it. When new answers arrive, the next summary is a new operation, and it costs again.
## What the model is allowed to see
The answers to that form, and nothing else: no account details, no other form, no other customer. The number of answers read is capped, each answer is trimmed, and the whole prompt has a size limit, so a form with a great many answers cannot become a great many credits.
The model is also told not to write a number. “Most people mention pricing” is allowed; “42% mention pricing” is not, because it would be a guess sitting next to a count that is not.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['Three credits, from the same balance as everything else. There is no second wallet.', 'The counts are counted from the rows; the model is never asked for a number.', 'A failed summary costs nothing, and the same answers are never summarised twice on your dime.'],
  'For developers who have a hundred answers and do not want to read all of them.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
