import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withPage, describe, draft, ready, created, provider, editDraft, editSuccess, failure, json,
  SPEC, ID, EDIT, RESPOND, EDIT_FORM_ID, EDIT_RECORD_ID, EDIT_DRAFT_ID, EDIT_VIEW,
  act, dom, sessionStorage,
} from './support/forms-page-harness.mjs';



test('the overview input carries a private initial prompt into the creation workspace without putting it in a URL', () => withPage({ start: '/app' }, async page => {
  await page.type(page.$('#future-prompt'), 'Register our team');
  await page.click(page.button('Start →'));
  await page.until(() => page.$('#form-request'), 'forms page opened');
  assert.equal(page.$('#form-request').value, 'Register our team');
  assert.equal(page.router.state.location.pathname, '/app/forms');
  assert.equal(page.posts('/interpret').length, 0);
}));

test('the home composer carries the chosen provider into the create workspace', () => withPage({ start: '/app' }, async page => {
  const chip = [...document.querySelectorAll('.target-chip')].find(button => button.textContent.includes('Typeform'));
  assert.ok(chip, 'both creation targets are offered on the home composer');
  await page.click(chip);
  await page.type(page.$('#future-prompt'), 'Register our team');
  await page.click(page.button('Start →'));
  await page.until(() => page.$('#form-request'), 'forms page opened');
  const chosen = [...document.querySelectorAll('.composer-target__option')].find(button => button.textContent.includes('Typeform'));
  assert.equal(chosen.getAttribute('aria-pressed'), 'true', 'the chosen target survives the navigation');
}));

test('reloading the tab resumes the user-owned specification from the server without a new model or Google call', () => withPage({ savedDraftId: ID, handlers: {
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { version: 4 }) }),
} }, async page => {
  await page.until(() => page.$('#review-title'), 'saved review loaded');
  assert.equal(page.$('#review-title').textContent, SPEC.title);
  // The composer stays on screen — this is the chat the user comes back to. What must not
  // happen is a second model call: the saved draft is shown, not rebuilt.
  assert.equal(page.$('#form-request').value, '');
  assert.equal(page.posts('/interpret').length, 0);
  assert.equal(page.posts('/revise').length, 0);
  assert.equal(page.posts('/confirm').length, 0);
  assert.equal(page.calls.filter(call => call.url === `/api/forms/draft/${ID}`).length, 1);
}));

test('a blocked draft restored after reload shows its partial result but cannot create another form', () => withPage({ savedDraftId: ID, handlers: {
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { status: 'blocked', result: {
    ok: false, failure: { code: 'provider_error', error: 'Google built only part of the form.', requestId: 'req_partial1', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' } },
  } }) }),
} }, async page => {
  // A blocked draft has nothing to review, so there is no review panel: it opens on the
  // "do not create this again" banner instead. Wait for that.
  await page.until(() => page.button('Start a different form after checking Google →'), 'saved partial result loaded');
  assert.match(page.text(), /Do not create this draft again/);
  assert.match(page.text(), /Google built only part of the form/);
  assert.equal(page.button('Create form →'), undefined);
  assert.equal(page.$(`a[href="${EDIT}"]`)?.href, EDIT);
  assert.equal(page.posts('/confirm').length, 0);
  assert.ok(page.button('Start a different form after checking Google →'));
}));
