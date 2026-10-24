import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withPage, describe, draft, ready, created, provider, editDraft, editSuccess, failure, json,
  SPEC, ID, EDIT, RESPOND, EDIT_FORM_ID, EDIT_RECORD_ID, EDIT_DRAFT_ID, EDIT_VIEW,
  act, dom, sessionStorage,
} from './support/forms-page-harness.mjs';



test('the protected workspace starts with natural language, never a JSON editor or a provider create request', () => withPage({}, async page => {
  assert.equal(page.router.state.location.pathname, '/app/forms');
  assert.ok(page.$('a[href="/app/forms"].active'));
  assert.ok(page.$('label[for="form-request"]'));
  assert.equal(page.$('#form-specification'), null);
  assert.equal(page.button('Create form →'), undefined);
  assert.match(page.text(), /Describe it/);
  assert.match(page.text(), /Microsoft Forms creation is not available/);
  assert.equal(page.posts('/confirm').length, 0);
}));
test('Enter sends the composer like the button; Shift+Enter keeps a newline', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
} }, async page => {
  await page.type(page.$('#form-request'), 'Line one');
  const box = page.$('#form-request');
  await act(async () => { box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await page.until(() => page.$('#review-title'), 'Enter submits the description');
  assert.match(page.text(), /Final Year Project Registration/);
}));
test('a sleeping server gets one automatic retry with an honest waking note, not an error', () => withPage({ handlers: {
  'POST /api/forms/interpret': (_init, calls) => calls.filter(call => call.url === '/api/forms/interpret').length === 1
    ? (async () => { throw new Error('socket hang up'); })()
    : (async () => {
      // Hold the recovery until the waking note has painted, so the test observes
      // narration deterministically instead of racing an instant retry.
      for (let i = 0; i < 50 && !document.body.textContent.includes('Waking up the server'); i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return ready();
    })(),
} }, async page => {
  await page.type(page.$('#form-request'), 'Register for my project');
  await page.click(page.button('Send →'));
  await page.until(() => page.text().includes('Waking up the server'), 'the retry is narrated, not silent');
  await page.until(() => page.$('#review-title'), 'the retried submission produces a review');
  assert.equal(page.posts('/interpret').length, 2, 'exactly one wake retry');
  assert.ok(!page.text().includes('could not confirm'), 'no failure bubble for a healed request');
}));
test('interpretation shows a loading state, then a readable review with routing and warnings; Google is untouched', () => {
  let resolve;
  const pending = new Promise(ok => { resolve = ok; });
  return withPage({ handlers: { 'POST /api/forms/interpret': () => pending } }, async page => {
    await page.type(page.$('#form-request'), 'Register for my project');
    await page.click(page.button('Send →'));
    assert.ok(page.button('Working…').disabled);
    assert.match(page.text(), /nothing is being created yet/i);
    assert.equal(page.posts('/confirm').length, 0);
    resolve(ready());
    await page.until(() => page.$('#review-title'), 'a review appears');
    assert.equal(page.$('#review-title').textContent, 'Final Year Project Registration');
    assert.equal(page.$$('.draft-item').length, SPEC.questions.length);
    assert.match(page.$('.draft-review').textContent, /Email · short answer/);
    assert.match(page.$('.draft-review').textContent, /Optional/);
    assert.match(page.$('.draft-review').textContent, /ROUTING SECTION/);
    assert.match(page.$('.draft-review').textContent, /Science/);
    assert.match(page.$('.draft-review').textContent, /Google does not check email address format/);
    assert.ok(page.button('Create form →'));
    assert.ok(page.button('Send change →'), 'the composer becomes the revision box once a draft is ready');
    assert.ok(page.button('Cancel'));
    assert.equal(page.posts('/confirm').length, 0, 'never auto-creates because a model returned a spec');
    assert.equal(sessionStorage.getItem('intake:current-form-draft'), ID);
  });
});
test('clarification is a focused follow-up and its answer is sent with the original request', () => withPage({ handlers: {
  'POST /api/forms/interpret': (init, calls) => calls.filter(call => call.url === '/api/forms/interpret').length === 1
    ? json({ status: 'needs_clarification', question: 'Which departments should respondents choose from?' }) : ready(),
} }, async page => {
  await page.type(page.$('#form-request'), 'List our departments.');
  await page.click(page.button('Send →'));
  await page.until(() => page.text().includes('Which departments'), 'the question is displayed as a thread message');
  assert.equal(page.posts('/confirm').length, 0);
  await page.type(page.$('#form-request'), 'Computer Science, Economics, Statistics');
  await page.click(page.button('Continue →'));
  await page.until(() => page.$('#review-title'), 'a draft appears');
  const second = JSON.parse(page.posts('/interpret')[1].init.body);
  // Every submission carries its own idempotency key so a retry can never be charged twice.
  const { operationId: secondKey, ...secondBody } = second;
  assert.match(secondKey, /^[A-Za-z0-9_-]{8,64}$/, 'a valid server-accepted operation id is sent');
  assert.deepEqual(secondBody, { provider: 'google', request: 'List our departments.', clarification: 'Computer Science, Economics, Statistics' });
}));
test('unsupported requests and model failures are recoverable without inventing a draft', () => withPage({ handlers: {
  'POST /api/forms/interpret': (_init, calls) => calls.filter(call => call.url === '/api/forms/interpret').length === 1
    ? json({ status: 'unsupported', explanation: 'File uploads cannot be created through this Google adapter.' })
    : failure({ code: 'model_not_configured', error: 'GROQ_API_KEY is missing. Nothing was created.' }, 503),
} }, async page => {
  await page.type(page.$('#form-request'), 'Collect a file');
  await page.click(page.button('Send →'));
  assert.match(page.text(), /File uploads cannot be created/);
  assert.equal(page.$('#review-title'), null);
  await page.type(page.$('#form-request'), 'Collect a file again');
  await page.click(page.button('Send →'));
  assert.match(page.text(), /GROQ_API_KEY is missing/);
  assert.ok(!page.button('Send →').disabled);
  assert.equal(page.posts('/confirm').length, 0);
}));
test('the composer lets a person choose Typeform, and that choice is what reaches the server', () => withPage({}, async page => {
  const chip = [...document.querySelectorAll('.composer-target__option')].find(button => button.textContent.includes('Typeform'));
  assert.ok(chip, 'Typeform is offered beside Google Forms');
  assert.match(page.text(), /Create in/, 'the target is visible before anything is described');
  await page.click(chip);
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  await page.type(page.$('#form-request'), 'Register people for our meetup.');
  await page.click(page.button('Send →'));
  await page.until(() => JSON.parse(page.posts('/interpret')[0]?.init.body ?? '{}').provider === 'typeform', 'the chosen provider is sent');
}));
test('a Typeform draft is reviewed as Typeform and never offers Google-only editing', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => json({ requestId: 'req_tf1', status: 'ready', draft: draft(SPEC, { provider: 'typeform' }) }, 201),
} }, async page => {
  await page.type(page.$('#form-request'), 'Register people for our meetup.');
  await page.click(page.button('Send →'));
  await page.until(() => page.$('#review-title'), 'a Typeform draft is reviewed');
  assert.match(page.$('.draft-review').textContent, /TYPEFORM/);
  assert.match(page.text(), /Nothing has been sent to Typeform yet/);
  assert.equal(page.$('.composer-target'), null, 'the provider is fixed once a draft exists');
  assert.ok(page.button('Create form →'));
}));

// ------------------------------------------------------------------ existing-form edit workflow

