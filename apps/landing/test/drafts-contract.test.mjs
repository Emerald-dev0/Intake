import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfirmedResponse, parseDraftLoad, parseInterpretResponse, parsePublicDraft } from '../src/lib/drafts.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';

const spec = parseFormSpecification({ title: 'Intake registration', questions: [
  { id: 'name', title: 'Full name', type: 'short_text', required: true },
  { id: 'needs', title: 'Need help?', type: 'multiple_choice', required: true, options: ['Yes', 'No'] },
  { id: 'help', title: 'How?', type: 'long_text', visibility: { when: { question: 'needs', equals: 'Yes' } } },
] }).specification;
const row = (extra = {}) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', provider: 'google', version: 1, status: 'ready', specification: spec,
  assumptions: [], warnings: [], result: null, createdAt: '2026-09-29T09:00:00.000Z', updatedAt: '2026-09-29T09:00:00.000Z', ...extra });

test('the browser accepts only a readable server-owned specification and does not need raw JSON input', () => {
  const draft = parsePublicDraft(row());
  assert.equal(draft.specification.questions[2].visibility.when.question, 'needs');
  assert.equal(draft.specification.questions[2].required, false);
  assert.equal(parseInterpretResponse(201, { status: 'ready', draft: row() }).status, 'ready');
  assert.equal(parseDraftLoad(200, { draft: row() }).draft.version, 1);
  assert.equal(parseInterpretResponse(200, { status: 'needs_clarification', question: 'Which options?' }).status, 'needs_clarification');
  assert.equal(parseInterpretResponse(200, { status: 'unsupported', explanation: 'File uploads are not supported.' }).status, 'unsupported');
  const longestValidEmailWarning = `"${'E'.repeat(500)}" was created as a short-answer question. The Google Forms API cannot turn on email validation, so Google will not check the format. Add it in Google Forms if you need it.`;
  assert.equal(parsePublicDraft(row({ warnings: [{ code: 'email_validation_unavailable', questionId: 'email', message: longestValidEmailWarning }] }))?.warnings[0].message, longestValidEmailWarning);
});

test('unreadable specifications, unknown owners/ids and malformed union replies fail closed', () => {
  for (const broken of [
    row({ id: 'javascript:alert(1)' }), row({ provider: 'microsoft' }), row({ version: 0 }), row({ status: 'pending' }),
    row({ specification: { title: 'No questions', questions: [] } }),
    row({ specification: { ...spec, questions: [{ ...spec.questions[0], type: 'file' }] } }),
    row({ specification: { ...spec, questions: [{ ...spec.questions[0], title: '<script>', options: ['oops'] }] } }),
    row({ assumptions: Array(7).fill('x') }), row({ status: 'created', result: null }), row({ status: 'creating', result: { ok: true } }),
    row({ status: 'ready', result: { ok: false, failure: { code: 'provider_error', error: 'Unknown', outcome: 'unknown', requestId: 'req_unknown' } } }),
    row({ status: 'blocked', result: { ok: false, failure: { code: 'provider_not_connected', error: 'Not connected', outcome: 'not_created', requestId: 'req_none' } } }),
  ]) assert.equal(parsePublicDraft(broken), null, JSON.stringify(broken));
  assert.equal(parseInterpretResponse(200, { status: 'ready', draft: row({ specification: null }) }).status, 'error');
  assert.equal(parseInterpretResponse(200, { status: 'ready', draft: null }).status, 'error');
  assert.equal(parseInterpretResponse(200, { status: 'needs_clarification' }).status, 'error');
  assert.equal(parseInterpretResponse(200, 'not JSON').status, 'error');
});

test('creation responses render only verified Google links and never assume success for unreadable bodies', () => {
  const body = { requestId: 'req_1', form: {
    id: 'f', provider: 'google', providerFormId: '1FAfakeForm0001abcdefghijklmnop', title: 'Live form', published: true, createdAt: null,
    responderUrl: 'javascript:alert(1)', editUrl: 'https://evil.example/forms/d/a/edit',
  }, warnings: [], draft: row({ status: 'created', result: { ok: true, requestId: 'req_1', form: {
    id: 'f', provider: 'google', providerFormId: '1FAfakeForm0001abcdefghijklmnop', title: 'Live form', published: true, createdAt: null,
    responderUrl: 'javascript:alert(1)', editUrl: 'https://evil.example/forms/d/a/edit',
  }, warnings: [] } }) };
  const parsed = parseConfirmedResponse(201, body);
  assert.equal(parsed.result.ok, true);
  assert.equal(parsed.result.form.responderUrl, null);
  assert.equal(parsed.result.form.editUrl, null);
  assert.equal(parsed.draft.result.form.responderUrl, null);
  const unreadable = parseConfirmedResponse(201, { form: { title: 'only title' } });
  assert.equal(unreadable.result.ok, false);
  assert.equal(unreadable.draft, null);
  assert.equal(unreadable.result.failure.outcome, undefined, 'the page must treat an unreadable success as uncertain');
});
