-- Phase: the mail reads properly.
--
-- Every Intake email changed: the row advertising a social account is gone, a provider notice
-- names the provider the way the product names it, and the details under the heading line up.
-- People read these letters, so the change ships with a changelog entry like everything else.
--
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'the-mail-reads-properly'; — the page and its entry
-- disappear together. The emails themselves are not affected: they are code, not data.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_the_mail_reads', 'the-mail-reads-properly', 'The mail reads properly now',
  'Every Intake email has been through a reading. The row advertising a social account is gone, a provider notice names the provider properly, and the details under the heading line up.',
  $notes$## The row that was never the product's
Every Intake email ended with a badge and a line inviting you to follow the product on X. The account behind that row was a personal one that had been configured as if it were the product's — which is not a row a product gets to print on every letter it sends. It is gone: from the footer, from the plain-text version of the letter, and from the setting that put it there.
The letter that invited you to follow along now points at the changelog instead. That is where the updates actually are, and every release there has a page of its own.
## The provider, named properly
When a connection ended, the subject line said "typeform was disconnected from Intake" — the raw identifier, in lower case, at the start of the sentence. It read like a typo because it was one: nobody had looked the provider's name up.
The name now comes from the same place the rest of the product gets it — Typeform, Google Forms, Microsoft Forms — and a line starts with a capital whatever it is handed. A name can no longer start a subject in lower case.
## A card that lines up
The details under the heading — the account, the time — had no width of their own. The table handed its spare room to the label column, so the values slid in and out with the length of their labels and the card looked as if it had been assembled from parts. The table is a fixed layout now: the labels have a column, and every value starts in the same place.
The mark in the header had the same trouble in a different way. It sat on the edge of the paper, to the left of the text it belongs to. It is padded to the column the card's text starts in now, and tightens on a narrow screen.
## What did not change
Nothing about what the mail says, when it goes out, or who it goes to. The same notices are sent, on the same triggers, with the same rules about what is optional and what is not. This release is about how the letter sits on the page once it has arrived.$notes$,
  ARRAY['improvement'], 'published', DATE '2026-10-29',
  '[{"label": "Changelog", "url": "/changelog"}]'::jsonb,
  ARRAY['The X row is gone from every email — the footer carries the mark, the words and a way to reply.', 'A provider notice reads "Typeform was disconnected from Intake", not "typeform was disconnected from Intake".', 'The details table gives its labels a column of their own, so the values start in the same place every time.', 'The mark in the header sits on the same column as the text in the card, and tightens on a narrow screen.'],
  'For everyone who reads Intake''s mail, and for whoever has to read a hundred of them in a week.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
