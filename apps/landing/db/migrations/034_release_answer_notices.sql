-- Phase: the answer notices.
--
-- A feature developers can use is a public announcement, so it ships with a changelog entry like
-- everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'be-told-about-new-answers'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_be_told_about_new_answers', 'be-told-about-new-answers', 'Ask to hear about new answers',
  'A developer can now ask to be emailed when one of their forms has new answers — every N answers, or a daily digest. Off until you turn it on.',
  $notes$## Off until you ask
There is a setting per project: email me when this project has new answers. It is off until you turn it on, and there is no version of this that is on by default.
## One note, not one per answer
You can choose every N answers — ten, say — or a daily digest. The point of a threshold is that three answers make one note rather than three, so a busy form does not become a flood.
The notice goes through the same mail system as every other message from Intake: the same delivery log, the same suppression list, and the same rule that the same notice is never sent twice. If a notice cannot be sent, the count is left alone and the next answer tries again.
## Your form, your answers
The notice is about your own form and goes to you. Nobody who filled the form in is ever written to from this — there is no way to make that happen, and no setting that would.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['Off by default. Nobody is told anything until you say so.', 'Every N answers, or a daily digest — never one email per answer.', 'The notice goes to you, about your own form. Nobody who filled it in is ever written to.'],
  'For developers who want to know that something came in without watching the inbox.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
