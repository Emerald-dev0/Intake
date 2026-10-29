-- Phase: the delete action.
--
-- A feature developers can use is a public announcement, so it ships with a changelog entry like
-- everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'delete-a-form'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_delete_a_form', 'delete-a-form', 'Delete a form when you are done with it',
  'A form can now be deleted from the console — but only once it is closed, and only when you type its address to confirm it.',
  $notes$## Finishing with a form
Every form has an address on the internet, and every answer is stored against it. When a form has done its job, you can now delete it from the console: the form, its versions and the answers it collected go together, and the address is free for the next thing.
## Two things the server will not let you do by accident
A form that is still live cannot be deleted. Close it first — that is one deliberate click, and it stops the public endpoint taking answers from the moment you do it. Nothing is thrown away in the meantime.
And the deletion has to carry the form's own address. If a request arrives from a tab you forgot about, or a client sends the same call twice, it takes nothing with it: the address has to match.
## Or archive it instead
If you only want a form out of the way for a while, archive it. That is reversible — restore it and it comes back as a draft, and its answers are still there. Deleting is for the forms you are finished with.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['A live form has to be closed first, so nothing is deleted while it is still collecting answers.', 'You type the form''s address to confirm. A stray click cannot take anything with it.', 'The form, its versions and its answers go together.'],
  'For developers who have finished with a form and want it out of the way.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
