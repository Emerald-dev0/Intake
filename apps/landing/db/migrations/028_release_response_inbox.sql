-- Phase: the response inbox.
--
-- A feature developers can use is a public announcement, so it ships with a changelog entry like
-- everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'the-response-inbox'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_the_response_inbox', 'the-response-inbox', 'The inbox, and a number you can trust',
  'The answers to a hosted form can now be read, searched and exported — with a count that comes from the database rather than from the page.',
  $notes$## Reading the answers
Every form has an inbox now. The questions are the columns, the answers are the rows, and the newest answer is at the top. There is a search box for the word somebody wrote, and paging when there are more answers than fit on one screen.
## The count is the count
The number of answers is counted by the database, not by counting the rows that happen to be on screen, and not by a model that might round it. It is the same number whether you are looking at the first page, the last page, or a search that matched one answer.
## The export is the table
The CSV file has the same columns as the table, in the same order, with the time of each answer in front. It is built by the server, not by the browser, so it works the same however many answers there are.
One small piece of care: a value that starts with a character a spreadsheet would read as a formula is escaped on the way out. An answer should never be able to run something in the file you open next.
## Whose answers are whose
An answer is readable by the account that owns the form and by nobody else. Somebody else asking for it gets the same answer a nonexistent form would get: nothing, and no confirmation that it ever existed.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['The count is counted by the database, so "12 answers" means twelve answers.', 'Search finds a word anywhere in the answers, not just in one column.', 'The CSV has the same columns as the table, and a value that a spreadsheet would treat as a formula is neutralised on the way out.'],
  'For developers who have a form collecting answers and would rather not build a dashboard to read them.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
