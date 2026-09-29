import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLE_SPECIFICATION,
  EXAMPLE_SPECIFICATION_JSON,
  FORM_ERROR_CODES,
  describeFailure,
  isFormErrorCode,
  parseCreateFormResponse,
  parseFormFailure,
  parseFormList,
  safeFormUrl,
} from '../src/lib/forms.ts';

const EDIT = 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit';
const RESPOND = 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform';
const goodForm = (extra = {}) => ({ id: 'rec-1', provider: 'google', providerFormId: '1FAfakeForm0001abcdefghijklmnop', title: 'Registration', editUrl: EDIT, responderUrl: RESPOND, published: true, createdAt: '2026-09-29T09:00:00.000Z', ...extra });

// ---------------------------------------------------------------- links

test('only https Google Forms links on the standard port are ever treated as links', () => {
  for (const good of [EDIT, RESPOND, `${RESPOND}?usp=sf_link`, 'HTTPS://DOCS.GOOGLE.COM/forms/d/abc/edit']) assert.ok(safeFormUrl(good), good);
  for (const bad of [
    'http://docs.google.com/forms/d/abc/edit',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'https://evil.example/forms/d/abc/edit',
    'https://docs.google.com.evil.example/forms/d/abc/edit',
    'https://evil.example/https://docs.google.com/forms/d/abc',
    'https://user:pass@docs.google.com/forms/d/abc/edit',
    'https://docs.google.com:8443/forms/d/abc/edit',
    'https://docs.google.com/document/d/abc/edit',
    'https://docs.google.com/forms/../evil',
    'https://docs.google.com',
    'https://forms.gle/abc',
    '//docs.google.com/forms/d/abc',
    '/forms/d/abc',
    'docs.google.com/forms/d/abc',
    '',
    '   ',
    `https://docs.google.com/forms/${'a'.repeat(3000)}`,
    null,
    undefined,
    42,
    {},
    ['https://docs.google.com/forms/d/abc'],
  ]) assert.equal(safeFormUrl(bad), null, String(bad));
});

// ---------------------------------------------------------------- reading a success

test('a success is read field by field: unknown fields are dropped and unsafe links become null', () => {
  const parsed = parseCreateFormResponse(201, {
    requestId: 'req_1',
    form: goodForm({ accessToken: 'LEAK', externalAccountId: 'acct', editUrl: 'javascript:alert(1)', responderUrl: 'https://evil.example/x' }),
    warnings: [{ code: 'w', questionId: 'q', message: 'Heads up', extra: 'x' }, { code: 'bad' }, 'nope'],
    accessToken: 'LEAK',
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.form, { id: 'rec-1', provider: 'google', providerFormId: '1FAfakeForm0001abcdefghijklmnop', title: 'Registration', editUrl: null, responderUrl: null, published: true, createdAt: '2026-09-29T09:00:00.000Z' });
  assert.deepEqual(parsed.warnings, [{ code: 'w', questionId: 'q', message: 'Heads up' }]);
  assert.equal(JSON.stringify(parsed).includes('LEAK'), false);
  assert.equal(parsed.requestId, 'req_1');
});

test('a 2xx answer that is not a valid created form is a failure, never a success', () => {
  for (const body of [null, 'ok', [], {}, { form: null }, { form: {} }, { form: goodForm({ published: 'yes' }) }, { form: goodForm({ provider: 'dropbox' }) }, { form: goodForm({ providerFormId: '' }) }, { form: goodForm({ title: '   ' }) }]) {
    const parsed = parseCreateFormResponse(200, body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
    assert.equal(parsed.failure.code, 'internal_error');
  }
});

test('a form without a record id or date is still shown, since the form exists', () => {
  const parsed = parseCreateFormResponse(201, { requestId: 'r', form: goodForm({ id: null, createdAt: null }) });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.form.id, null);
  assert.equal(parsed.form.createdAt, null);
});

// ---------------------------------------------------------------- reading a failure

test('a failure keeps only known, well-formed fields', () => {
  const failure = parseFormFailure(502, {
    error: 'Rejected.\u0000\u0007',
    code: 'provider_rejected',
    requestId: 'req_9',
    provider: 'google',
    stage: 'add_questions',
    outcome: 'partial',
    retryable: false,
    detail: 'Invalid value',
    issues: [{ code: 'x', path: 'questions[0]', message: 'Bad', hint: 'Fix it', extra: 1 }, { code: 'y' }, null],
    partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: 'javascript:alert(1)', state: 'publish_unconfirmed', secret: 'LEAK' },
    accessToken: 'LEAK',
  });
  assert.deepEqual(failure, {
    error: 'Rejected.',
    code: 'provider_rejected',
    requestId: 'req_9',
    provider: 'google',
    stage: 'add_questions',
    outcome: 'partial',
    retryable: false,
    detail: 'Invalid value',
    issues: [{ code: 'x', path: 'questions[0]', message: 'Bad', hint: 'Fix it' }],
    partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: null, state: 'publish_unconfirmed' },
  });
  assert.equal(JSON.stringify(failure).includes('LEAK'), false);
});

test('unknown or missing codes fall back by status, and an unreadable body says nothing can be assumed', () => {
  assert.equal(parseFormFailure(400, { error: 'x', code: 'made_up' }).code, 'invalid_request');
  assert.equal(parseFormFailure(500, { error: 'x', code: 'made_up' }).code, 'internal_error');
  assert.equal(parseFormFailure(401, { error: 'x' }).code, 'not_authenticated');
  for (const body of [null, undefined, 'html', [], {}, { error: '' }, { error: 42 }]) {
    const failure = parseFormFailure(502, body);
    assert.equal(failure.code, 'internal_error');
    assert.match(failure.error, /Nothing can be assumed about the form/);
  }
  assert.match(parseFormFailure(401, null).error, /session ended/);
  assert.equal(parseFormFailure(502, { error: 'x', outcome: 'gone', stage: 'nowhere', provider: 'dropbox', retryable: 'no' }).outcome, undefined);
});

test('lists of issues and warnings are bounded', () => {
  const issues = Array.from({ length: 120 }, (_, index) => ({ code: 'c', path: `p${index}`.padEnd(400, 'x'), message: 'm'.repeat(2000) }));
  const failure = parseFormFailure(422, { error: 'x', code: 'validation_failed', issues });
  assert.equal(failure.issues.length, 50);
  assert.ok(failure.issues.every(issue => issue.path.length <= 200 && issue.message.length <= 600));
});

// ---------------------------------------------------------------- reading the list

test('a list is accepted only if every row is well formed', () => {
  const row = (extra = {}) => ({ id: 'a', provider: 'google', providerFormId: 'abc12345', title: 'T', status: 'created', failureStage: null, editUrl: EDIT, responderUrl: RESPOND, createdAt: '2026-09-29T09:00:00.000Z', ...extra });
  assert.equal(parseFormList({ forms: [row(), row({ id: 'b', status: 'incomplete', failureStage: 'publish', responderUrl: null })] }).length, 2);
  assert.deepEqual(parseFormList({ forms: [] }), []);
  for (const bad of [null, [], 'x', {}, { forms: 'nope' }, { forms: [null] }, { forms: [row({ id: '' })] }, { forms: [row({ status: 'done' })] }, { forms: [row({ createdAt: 'yesterday' })] }, { forms: [row({ provider: 'dropbox' })] }, { forms: [row(), 'x'] }]) {
    assert.equal(parseFormList(bad), null, JSON.stringify(bad));
  }
  const unsafe = parseFormList({ forms: [row({ editUrl: 'javascript:alert(1)', responderUrl: 'http://docs.google.com/forms/d/e/x/viewform' })] });
  assert.deepEqual([unsafe[0].editUrl, unsafe[0].responderUrl], [null, null]);
  assert.equal(parseFormList({ forms: Array.from({ length: 300 }, (_, index) => row({ id: `f${index}` })) }).length, 100);
});

// ---------------------------------------------------------------- presentation

test('each failure is presented with the right tone, heading and action', () => {
  const view = (code, outcome) => describeFailure({ error: 'x', code, requestId: '', ...(outcome ? { outcome } : {}) });
  assert.deepEqual(view('provider_not_connected'), { tone: 'warn', heading: 'Google is not connected', action: 'connect' });
  assert.deepEqual(view('provider_reauthorization_required'), { tone: 'warn', heading: 'Google authorization needs renewing', action: 'reconnect' });
  assert.equal(view('validation_failed').action, null);
  assert.match(view('unsupported_by_provider').heading, /cannot express/);
  assert.equal(view('provider_error', 'partial').heading, 'The form was only partly created');
  assert.equal(view('provider_unavailable', 'unknown').heading, 'Intake could not confirm the result');
  assert.equal(view('provider_rejected', 'not_created').heading, 'The form was not created');
  assert.equal(view('internal_error').heading, 'Something went wrong');
  for (const code of FORM_ERROR_CODES) {
    const shown = view(code);
    assert.ok(shown.heading.length > 3 && ['warn', 'bad'].includes(shown.tone), code);
    if (shown.action) assert.ok(['provider_not_connected', 'provider_reauthorization_required'].includes(code), 'only connection problems offer an action');
  }
});

test('error codes can be recognised, and nothing else passes', () => {
  for (const code of FORM_ERROR_CODES) assert.equal(isFormErrorCode(code), true);
  for (const other of ['', 'PROVIDER_ERROR', 'constructor', '__proto__', null, undefined, 3, {}]) assert.equal(isFormErrorCode(other), false);
});

test('the example text parses back to the example object', () => {
  assert.deepEqual(JSON.parse(EXAMPLE_SPECIFICATION_JSON), EXAMPLE_SPECIFICATION);
});
