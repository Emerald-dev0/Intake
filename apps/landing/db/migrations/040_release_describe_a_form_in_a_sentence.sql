-- Phase: writing a hosted form from one sentence.
--
-- The developer console can now ask the same AI that writes provider forms to write the questions
-- of a form Intake hosts itself. One operation, the same credits, the same ledger — and the form
-- arrives as a draft the developer reads before anything is published.
--
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'describe-a-form-in-a-sentence'; — the page and its
-- entry disappear together. The other releases are untouched.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_describe_a_form_in_a_sentence', 'describe-a-form-in-a-sentence', 'Describe a form in a sentence',
  'The developer console can now write the questions of a hosted form from a sentence — the same AI, the same credits, and nothing published until you have read it.',
  $notes$## The sentence you would have typed anyway
Making a form by hand is not hard, it is tedious. You open a builder, you decide what to ask, you type it, you set what is required, you read it back to check you did not leave a required field blank. It is the kind of work that is easy to start and annoying to finish.
You already know the sentences. “A sign-up form for our design partners.” “Ask a freelancer what they charge per hour.” “A short application for the beta list.” That is the whole description, and until today the developer console made you write the questions out longhand anyway.
Now it does not. Press “Describe it” in a project, write the sentence, and Intake writes the questions: the labels, the types, the required flags, the choices where choices belong. You read them, change what you like, and publish.
## What the model does, and what it cannot do
The model writes words. That is all it does. It cannot create a form, publish a form, move a form, or reach the database — it returns a proposal, and the server turns that proposal into a form definition, checks it against what a hosted form can actually render, and makes a draft.
If your sentence needs something this kind of form cannot do — a file upload, a payment, a question that only appears for some people — Intake says so instead of quietly dropping it. That is the same rule the provider forms follow: an honest no beats a form that quietly lost half of what you asked for.
And if the sentence is ambiguous in a way that would change the form, Intake asks one question rather than guessing. You answer it, and the answer goes into the same proposal.
## The credits you already have
This is the same AI, the same ledger and the same twenty credits a day as everything else in Intake. There is no second wallet for developers and no new currency. A small form costs two credits, a bigger one costs a little more, and the console tells you what it charged when it is done.
Nothing is charged when the model fails, and nothing is charged for the clarifying question. If your browser drops the connection and sends the same request again, the server recognises it and hands you the form it already made instead of making a second copy — one operation, one form, one charge.
## Starter templates, for the forms people actually want
Some sentences are the same sentence everybody writes. There is a row of templates above the box — waitlist, feedback, contact, sign-in, newsletter, beta application, support request, booking, RSVP, one question — and pressing one puts its sentence in the box.
It is a shortcut, not a fixed form: the sentence is yours to read and change before it is sent, and the questions that come back are written for the sentence you ended up with. The sign-in template asks for an email address and a one-time code, never a password — a hosted form collects answers, it does not hold a session, and it is not the place a password should be typed.
## What it will not do
- It does not publish anything. The form it writes is a draft until you publish it yourself.
- It does not choose a provider or a Google account. A hosted form lives on an Intake address, which is the point of it.
- It does not invent requirements. If it cannot responsibly guess a list of choices, it asks you for the list.
- It is not a second builder. Everything it writes can be edited by hand afterwards, and everything you can do by hand you can still do.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label": "Developers", "url": "/developers"}, {"label": "Changelog", "url": "/changelog"}]'::jsonb,
  ARRAY['Open a project, press “Describe it”, and write what the form should ask. The questions come back to read before anything is live.', 'The same twenty daily credits as the rest of Intake. A small form costs two of them, and the price is shown when it is charged.', 'If Intake needs one more detail, it asks — and that question is free. A provider that fails costs nothing at all.', 'The form arrives as a draft. You edit the questions, publish when they are right, and the address never moves.', 'Starter templates for the forms people actually reach for — waitlist, feedback, contact, sign-in, RSVP — put the sentence in the box for you.'],
  'For developers who would rather describe a form than type fourteen questions into a builder.',
  TIMESTAMPTZ '2026-10-29T17:00:00.000Z', TIMESTAMPTZ '2026-10-29T17:00:00.000Z', TIMESTAMPTZ '2026-10-29T17:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
