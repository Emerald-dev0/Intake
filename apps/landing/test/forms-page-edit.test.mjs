import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withPage, describe, draft, ready, created, provider, editDraft, editSuccess, failure, json,
  SPEC, ID, EDIT, RESPOND, EDIT_FORM_ID, EDIT_RECORD_ID, EDIT_DRAFT_ID, EDIT_VIEW,
  act, dom, sessionStorage, recentGoogleForm,
} from './support/forms-page-harness.mjs';



test('existing-form UI retrieves fresh state, previews an exact diff, and applies only after explicit confirmation to the original', () => withPage({ recent: [recentGoogleForm], handlers: {
  'POST /api/forms/edit/inspect': () => json({ requestId: 'req_inspect1', form: EDIT_VIEW }),
  'POST /api/forms/edit/interpret': () => json({ requestId: 'req_editplan1', status: 'ready', draft: editDraft() }, 201),
  'POST /api/forms/edit/confirm': () => {
    const applied = editDraft({ version: 2, status: 'applied', current: { ...EDIT_VIEW, title: editSuccess.title }, result: editSuccess });
    return json({ requestId: 'req_editdone1', result: editSuccess, draft: applied });
  },
} }, async page => {
  await page.click(page.button('Edit an existing form'));
  await page.until(() => page.$('#edit-form-record'), 'recent Google form selector is shown');
  assert.match(page.text(), /Drive-wide search is not available/);
  await page.click(page.button('Inspect current form →'));
  await page.until(() => page.$('#edit-request'), 'current provider form is displayed');
  assert.match(page.text(), /Full name/);
  assert.deepEqual(JSON.parse(page.posts('/edit/inspect')[0].init.body), { target: { kind: 'record', formRecordId: EDIT_RECORD_ID } });
  await page.type(page.$('#edit-request'), 'Rename the form for the 2027 showcase.');
  await page.click(page.button('Prepare edit proposal →'));
  await page.until(() => page.$('#edit-review-title'), 'change preview is displayed');
  assert.equal(page.$('#edit-review-title').textContent, 'Rename the form');
  assert.match(page.text(), /Original Google Form/);
  assert.match(page.text(), /Project registration.*Project registration 2027/);
  assert.match(page.text(), /No Google change has been made yet/);
  assert.equal(page.button('Confirm and apply edit →').disabled, true);
  assert.equal(page.posts('/edit/confirm').length, 0);
  assert.equal(page.posts('/confirm').length, 0, 'the create-form endpoint is never used');
  await page.click(page.$('.edit-confirm-check input[type="checkbox"]'));
  assert.equal(page.button('Confirm and apply edit →').disabled, false);
  await page.click(page.button('Confirm and apply edit →'));
  await page.until(() => page.$('.edit-success'), 'verified original-form result is displayed');
  assert.match(page.text(), /ORIGINAL FORM UPDATED/);
  assert.match(page.text(), new RegExp(EDIT_FORM_ID));
  assert.deepEqual(JSON.parse(page.posts('/edit/confirm')[0].init.body), { draftId: EDIT_DRAFT_ID, version: 1, confirm: true });
  assert.equal(page.posts('/confirm').length, 0);
  assert.equal(page.$('.edit-success a[href="' + RESPOND + '"]').href, RESPOND);
  assert.equal(page.$('.edit-success a[href="' + EDIT + '"]').href, EDIT);
}));
test('revising an edit replaces its preview, resets confirmation, and never applies the old proposal', () => withPage({ recent: [recentGoogleForm], handlers: {
  'POST /api/forms/edit/inspect': () => json({ requestId: 'req_inspect1', form: EDIT_VIEW }),
  'POST /api/forms/edit/interpret': () => json({ requestId: 'req_editplan1', status: 'ready', draft: editDraft() }, 201),
  'POST /api/forms/edit/revise': () => {
    const plan = { formId: EDIT_FORM_ID, summary: 'Change the form title', operations: [{ type: 'update_title', title: 'Project showcase registration' }] };
    const revised = editDraft({ version: 2, plan, changes: [{ type: 'update_title', title: 'Form title', detail: '“Project registration” → “Project showcase registration”', destructive: false }] });
    return json({ requestId: 'req_editrevise1', status: 'ready', draft: revised });
  },
} }, async page => {
  await page.click(page.button('Edit an existing form'));
  await page.until(() => page.$('#edit-form-record'), 'recent Google form selector is shown');
  await page.click(page.button('Inspect current form →'));
  await page.until(() => page.$('#edit-request'), 'current form is inspected');
  await page.type(page.$('#edit-request'), 'Rename the form.');
  await page.click(page.button('Prepare edit proposal →'));
  await page.until(() => page.$('#edit-review-title'), 'proposal is ready');
  await page.click(page.$('.edit-confirm-check input[type="checkbox"]'));
  assert.equal(page.button('Confirm and apply edit →').disabled, false);
  await page.type(page.$('#edit-revision'), 'Use “Project showcase registration” instead.');
  await page.click(page.button('Revise proposal →'));
  await page.until(() => page.$('#edit-review-title')?.textContent === 'Change the form title', 'revised preview replaces the old one');
  assert.equal(page.$('.edit-confirm-check input[type="checkbox"]').checked, false);
  assert.equal(page.button('Confirm and apply edit →').disabled, true);
  const { operationId: reviseKey, ...revisedEdit } = JSON.parse(page.posts('/edit/revise')[0].init.body);
  assert.match(reviseKey, /^[A-Za-z0-9_-]{8,64}$/);
  assert.deepEqual(revisedEdit, { draftId: EDIT_DRAFT_ID, version: 1, request: 'Use “Project showcase registration” instead.' });
  assert.equal(page.posts('/edit/confirm').length, 0);
  assert.equal(page.posts('/confirm').length, 0);
}));

// ------------------------------------------------------------------ revisions and confirmation
test('editing with Intake sends only the draft id/version and instruction; preserves review until a revised draft returns', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/revise': () => {
    const spec = structuredClone(SPEC);
    spec.questions.find(q => q.id === 'email').required = false;
    spec.questions.splice(2, 0, { id: 'student_id', title: 'Student ID', type: 'short_text', required: true });
    return json({ status: 'ready', draft: draft(spec, { version: 2 }) });
  },
} }, async page => {
  await describe(page);
  await page.type(page.$('#form-request'), 'Make email optional and add a student ID question.');
  await page.click(page.button('Send change →'));
  await page.until(() => page.$$('.draft-item').length === SPEC.questions.length + 1, 'updated review');
  assert.match(page.$('.draft-review').textContent, /Student ID/);
  assert.equal(page.$$('.draft-item').find(item => item.textContent.includes('Email address')).textContent.includes('Optional'), true);
  const { operationId: revisionKey, ...revision } = JSON.parse(page.posts('/revise')[0].init.body);
  assert.match(revisionKey, /^[A-Za-z0-9_-]{8,64}$/);
  assert.deepEqual(revision, { draftId: ID, version: 1, request: 'Make email optional and add a student ID question.' });
  assert.equal(page.posts('/confirm').length, 0);
  assert.ok(page.button('Send change →'), 'another revision can be requested from the composer');
}));
test('a failed revision leaves the review and confirmation intact', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/revise': () => failure({ error: 'Intake could not validate the interpretation.', code: 'model_invalid_output', outcome: 'not_created' }),
} }, async page => {
  await describe(page);
  await page.type(page.$('#form-request'), 'Add a date picker.');
  await page.click(page.button('Send change →'));
  assert.match(page.text(), /could not validate the interpretation/);
  assert.equal(page.$('#review-title').textContent, SPEC.title);
  assert.ok(page.button('Create form →'));
  assert.equal(page.posts('/confirm').length, 0);
}));
test('confirmation is explicit, progress locks the action, success renders only real safe URLs and recent forms reload', () => {
  let resolve;
  const pending = new Promise(ok => { resolve = ok; });
  return withPage({ handlers: {
    'POST /api/forms/interpret': () => ready(),
    'POST /api/forms/confirm': () => pending,
  } }, async page => {
    await describe(page);
    await page.click(page.button('Create form →'));
    assert.ok(page.button('Creating your form…').disabled);
    assert.match(page.text(), /Google is building your form/);
    assert.equal(page.posts('/confirm').length, 1);
    await page.click(page.button('Creating your form…'));
    assert.equal(page.posts('/confirm').length, 1, 'double click does nothing');
    const success = { ...created(), draft: draft(SPEC, { status: 'created', result: { ok: true, ...created() } }) };
    resolve(json(success, 201));
    await page.until(() => page.text().includes('Form created.'), 'creation success');
    assert.equal(page.button('Create form →'), undefined);
    const links = page.$$('.draft-result a');
    assert.deepEqual(links.map(link => link.href), [RESPOND, EDIT]);
    assert.ok(links.every(link => link.target === '_blank' && link.rel.includes('noreferrer')));
    assert.ok(page.button('Start another form →'));
    assert.ok(page.calls.filter(call => call.url === '/api/forms' && call.method === 'GET').length >= 2);
    assert.deepEqual(Object.keys(JSON.parse(page.posts('/confirm')[0].init.body)).sort(), ['confirm', 'draftId', 'version']);
    assert.equal(JSON.parse(page.posts('/confirm')[0].init.body).confirm, true);
  });
});
