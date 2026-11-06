-- Phase: the optional Google response permission is reachable, and granting it is safe.
--
-- Response Insights needed one more Google permission than creating a form does, and Intake
-- enforced it correctly — but no button anywhere started that request, so a person without the
-- permission was shown an error with no way out of it.
--
-- The panel now explains which permission is needed and offers one button; the grant keeps the
-- refresh token it already had; the stored permissions are the union of what was granted before
-- and what was granted now; and the privacy policy, the FAQ and the trust page say what Intake
-- really asks for.
--
-- The entry is seeded here as well as bundled with the site, so the changelog says so.
--
-- Rollback: DELETE FROM release WHERE slug = 'ask-for-response-reading'; — the entry disappears. The other
-- releases are untouched, and the notes bundled with the site still carry this entry.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_ask_for_response_reading', 'ask-for-response-reading', 'Ask for response reading when you want it',
  'Response insights had a permission behind them and no way to grant it. Now there is one button, in the place you were already looking, and granting it cannot cost you the access you already had.',
  $notes$## The error with no way out of it
Response insights need one more Google permission than creating a form does: the ability to read the responses people give you. Intake asked for it as an optional addition, and the server enforced it properly.
What was missing was the other end. There was no button anywhere that started that request, so a person without the permission opened response insights, was told the screen was not available, and had nowhere to go. The permission existed on paper and in the API, and nowhere a person could reach it.
On top of that, the same screen was written as though the permission were always there — a line of code said so — so the one screen that was supposed to explain the situation could not be the screen that explained it.
## One button, in the place you were already looking
Open response insights and Intake now says what is missing and why it is needed: one extra Google permission, to read the answers so it can count them, separate from the permission you already gave to create and edit your forms. It says what happens to your answers — they stay in your Google form, and Intake does not store them — and then offers one button.
Pressing it takes you to Google, through the same handshake that connects your account. Google adds the permission to what you already granted rather than replacing it. You come back to the form you were looking at, and Intake says what happened.
If you say no, nothing changes. The form you were looking at is still there, the access you already had is exactly as it was, and you are not asked again. The same button is on the Connections screen, under Manage, so you can see what you have allowed and change it.
## What the grant could have cost you, and no longer can
Allowing a second permission goes back through Google, and Google sometimes answers without a refresh token. Intake was writing that answer over the refresh token it already had, which would have left a working connection unable to renew itself — an hour later, or a week later, depending on who was looking.
It now keeps the refresh token it has. A new one replaces it; the absence of one changes nothing.
The permissions themselves were stored as whatever the last answer said. They are now the union of what was granted before and what was granted now, compared without regard to how the provider spells or repeats them. A permission you were granted earlier is never quietly dropped, and a permission you were asked for but did not get is never recorded as though you had.
## What we said about all this
The privacy policy said Intake never requests a responses scope and cannot read your form responses. The FAQ said Intake has no technical way to read answers. The trust page had a line under the things Intake never does: "Read your form responses".
All three were written when that was true, and then the feature shipped and the copy did not follow. They now say what is actually asked for and when it is asked for: the permission is optional, it is requested only when you open response insights and choose to allow it, and your answers are read to produce a summary and are not kept.
## What did not change
Connecting Google Forms still asks for one scope. Response reading is still never requested when you connect, still never requested for a Typeform, and still not something Intake can do without your say-so. No Drive scope, no Sheets scope, and no new Google service is touched.
The existing connections still work. A person who already connected Google keeps the same access they had, and a person who already allowed response reading is never asked for it again.$notes$,
  ARRAY['feature', 'fix'], 'published', DATE '2026-11-06',
  '[{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['Opening response insights without the permission now explains which Google permission is needed and offers one button to allow it.', 'Allowing it sends you back to the form you were looking at, and says plainly what happened — including when you said no.', 'A grant that returns no refresh token no longer wipes the one already stored, so the connection keeps renewing.', 'Your permissions are the union of what you granted before and what you granted now, and a refused grant changes nothing.', 'The privacy policy, the FAQ and the trust page now say what Intake really asks for.'],
  'For anyone who opened response insights, saw an error, and had no way to fix it.',
  TIMESTAMPTZ '2026-11-06T09:00:00.000Z', TIMESTAMPTZ '2026-11-06T09:00:00.000Z', TIMESTAMPTZ '2026-11-06T09:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
