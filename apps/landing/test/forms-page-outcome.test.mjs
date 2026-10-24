import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withPage, describe, draft, ready, created, provider, editDraft, editSuccess, failure, json,
  SPEC, ID, EDIT, RESPOND, EDIT_FORM_ID, EDIT_RECORD_ID, EDIT_DRAFT_ID, EDIT_VIEW,
  act, dom, sessionStorage,
} from './support/forms-page-harness.mjs';



test('provider not connected retains the reviewed draft and links to Connections, not sign-in', () => withPage({ google: { status: 'not_connected', accountEmail: null }, handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/confirm': () => failure({ error: 'Google is not connected. Nothing was created.', code: 'provider_not_connected', outcome: 'not_created', draft: draft() }, 409),
} }, async page => {
  await describe(page);
  assert.ok(page.$('a[href="/app/connections"]'));
  await page.click(page.button('Create form →'));
  assert.match(page.text(), /Google is not connected\. Nothing was created/);
  assert.ok(page.button('Create form →'), 'retry remains possible after connecting');
  assert.equal(page.router.state.location.pathname, '/app/forms');
}));

test('partial or unknown outcomes disable repeat creation and keep the real partial link', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/confirm': () => failure({ error: 'Questions were not accepted. A partly built form exists.', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' }, draft: draft(SPEC, { status: 'blocked', result: { ok: false, failure: { error: 'Questions were not accepted. A partly built form exists.', code: 'provider_error', requestId: 'req_failed1', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' } } } }) }),
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { status: 'blocked', result: { ok: false, failure: { error: 'Questions were not accepted. A partly built form exists.', code: 'provider_error', requestId: 'req_failed1', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' } } } }) }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Create form →'));
  assert.match(page.text(), /partly built form exists/);
  assert.match(page.text(), /Do not create this draft again/);
  assert.equal(page.button('Create form →'), undefined);
  assert.equal(page.$('a[href="' + EDIT + '"]') !== null, true);
  await page.click(page.button('Check draft status'));
  assert.equal(page.posts('/confirm').length, 1);
}));

test('a dropped confirmation response is uncertain: no automatic retry and draft status must be checked', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/confirm': () => { throw new Error('connection dropped'); },
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { status: 'creating' }) }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Create form →'));
  assert.match(page.text(), /A Google Form may exist/);
  assert.equal(page.button('Create form →'), undefined);
  await page.click(page.button('Check draft status'));
  assert.equal(page.posts('/confirm').length, 1);
  assert.match(page.text(), /Creation was started/);
}));

test('cancel discards a ready draft, never calls the provider, and returns to the natural-language entry', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  [`DELETE /api/forms/draft/${ID}`]: () => new Response(null, { status: 204 }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Cancel'));
  assert.ok(page.$('#form-request'));
  assert.equal(page.$('#review-title'), null);
  assert.equal(sessionStorage.getItem('intake:current-form-draft'), null);
  assert.equal(page.posts('/confirm').length, 0);
  assert.equal(page.calls.filter(call => call.method === 'DELETE').length, 1);
}));
