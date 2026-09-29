import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormEngineError } from '../server/forms/errors.ts';
import { QUESTION_TYPES, SPEC_LIMITS } from '../server/forms/specification.ts';
import { ensureValidatedSpecification, isValidatedSpecification, parseFormSpecification } from '../server/forms/validation.ts';
import { EXAMPLE_SPECIFICATION } from '../src/lib/forms.ts';

const text = (id = 'name', extra = {}) => ({ id, type: 'short_text', title: `Question ${id}`, ...extra });
const spec = (questions, extra = {}) => ({ title: 'Registration', questions, ...extra });

function issuesOf(input) {
  const result = parseFormSpecification(input);
  assert.equal(result.ok, false, 'expected the specification to be rejected');
  return result.issues;
}

function assertIssue(issues, code, path) {
  const found = issues.find(issue => issue.code === code && (path === undefined || issue.path === path));
  assert.ok(found, `expected ${code}${path ? ` at ${path}` : ''}, got ${JSON.stringify(issues.map(i => [i.code, i.path]))}`);
  return found;
}

test('a valid short-text specification is accepted and normalized', () => {
  const result = parseFormSpecification({ title: '  Contact  us ', description: ' Say hello. ', questions: [{ id: 'name', type: 'short_text', title: 'Full name', required: true }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.specification, {
    title: 'Contact us',
    description: 'Say hello.',
    questions: [{ id: 'name', title: 'Full name', type: 'short_text', required: true }],
  });
});

test('a valid multiple-choice specification is accepted', () => {
  const result = parseFormSpecification(spec([{ id: 'level', type: 'multiple_choice', title: 'Level', options: ['100', '200'] }]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.specification.questions[0].options, ['100', '200']);
  assert.equal(result.specification.questions[0].required, false, 'required defaults to false and is always explicit');
});

test('every supported question type validates, and the type list matches the brief', () => {
  assert.deepEqual([...QUESTION_TYPES], ['short_text', 'long_text', 'email', 'multiple_choice', 'dropdown', 'checkboxes']);
  const result = parseFormSpecification(spec([
    text('a'),
    { id: 'b', type: 'long_text', title: 'B', description: 'Tell us more' },
    { id: 'c', type: 'email', title: 'C' },
    { id: 'd', type: 'multiple_choice', title: 'D', options: ['x'] },
    { id: 'e', type: 'dropdown', title: 'E', options: ['x', 'y'] },
    { id: 'f', type: 'checkboxes', title: 'F', options: ['x', 'y'] },
  ]));
  assert.equal(result.ok, true);
});

test('the example shown in the workspace is itself valid', () => {
  assert.equal(parseFormSpecification(EXAMPLE_SPECIFICATION).ok, true);
});

test('a missing, empty or non-text title is rejected with a structured issue', () => {
  for (const title of [undefined, null, '', '   ', '\n\t', 42, {}]) {
    const issues = issuesOf({ title, questions: [text()] });
    const issue = issues.find(item => item.path === 'title');
    assert.ok(issue, `title ${JSON.stringify(title)} should be reported`);
    assert.ok(['title_required', 'invalid_type'].includes(issue.code));
    assert.equal(typeof issue.message, 'string');
  }
  assertIssue(issuesOf({ questions: [text()] }), 'title_required', 'title');
});

test('choice questions need options: missing or empty lists are rejected', () => {
  for (const type of ['multiple_choice', 'dropdown', 'checkboxes']) {
    const missing = issuesOf(spec([{ id: 'q', type, title: 'Pick' }]));
    const issue = assertIssue(missing, 'options_required', 'questions[0].options');
    assert.match(issue.message, new RegExp(type));
    assert.ok(issue.hint);
    assertIssue(issuesOf(spec([{ id: 'q', type, title: 'Pick', options: [] }])), 'options_required', 'questions[0].options');
    assertIssue(issuesOf(spec([{ id: 'q', type, title: 'Pick', options: null }])), 'options_required', 'questions[0].options');
  }
});

test('options are rejected on text questions, but an empty list from generated output is tolerated', () => {
  assertIssue(issuesOf(spec([{ id: 'q', type: 'short_text', title: 'Name', options: ['a'] }])), 'options_not_allowed', 'questions[0].options');
  const tolerated = parseFormSpecification(spec([{ id: 'q', type: 'email', title: 'Email', options: [] }]));
  assert.equal(tolerated.ok, true);
  assert.equal('options' in tolerated.specification.questions[0], false);
});

test('option values are checked: strings only, not empty, not repeated, not too many', () => {
  const base = { id: 'q', type: 'dropdown', title: 'Pick' };
  assertIssue(issuesOf(spec([{ ...base, options: ['a', 3] }])), 'option_invalid', 'questions[0].options[1]');
  assertIssue(issuesOf(spec([{ ...base, options: ['a', '  '] }])), 'option_invalid', 'questions[0].options[1]');
  assertIssue(issuesOf(spec([{ ...base, options: ['Yes', 'yes'] }])), 'duplicate_option', 'questions[0].options[1]');
  assertIssue(issuesOf(spec([{ ...base, options: 'Yes,No' }])), 'invalid_type', 'questions[0].options');
  assertIssue(issuesOf(spec([{ ...base, options: Array.from({ length: SPEC_LIMITS.maxOptions + 1 }, (_, i) => `o${i}`) }])), 'too_many_options');
});

test('an unsupported or missing question type is rejected and lists what is supported', () => {
  const issue = assertIssue(issuesOf(spec([{ id: 'q', type: 'signature', title: 'Sign' }])), 'unsupported_question_type', 'questions[0].type');
  for (const type of QUESTION_TYPES) assert.match(issue.message, new RegExp(type));
  assertIssue(issuesOf(spec([{ id: 'q', title: 'No type' }])), 'question_type_required', 'questions[0].type');
  assertIssue(issuesOf(spec([{ id: 'q', type: 7, title: 'Numeric type' }])), 'unsupported_question_type', 'questions[0].type');
});

test('demo and README vocabulary is refused with a pointer to the right type', () => {
  const single = assertIssue(issuesOf(spec([{ id: 'q', type: 'single_choice', title: 'Pick', options: ['a'] }])), 'unsupported_question_type');
  assert.match(single.hint, /multiple_choice/);
  for (const type of ['phone', 'number', 'date', 'time', 'rating']) {
    assertIssue(issuesOf(spec([{ id: 'q', type, title: 'x' }])), 'unsupported_question_type');
  }
});

test('duplicate question ids are rejected, including ids that differ only by capitalization', () => {
  const exact = assertIssue(issuesOf(spec([text('name'), text('name')])), 'duplicate_question_id', 'questions[1].id');
  assert.match(exact.message, /questions\[0\]/);
  assertIssue(issuesOf(spec([text('Email'), text('email')])), 'duplicate_question_id', 'questions[1].id');
});

test('question ids must be present and well formed', () => {
  assertIssue(issuesOf(spec([{ type: 'short_text', title: 'x' }])), 'question_id_required', 'questions[0].id');
  for (const id of ['1abc', 'has space', '', 'a'.repeat(SPEC_LIMITS.maxIdLength + 1), 'semi;colon']) {
    assertIssue(issuesOf(spec([text(id)])), 'question_id_invalid', 'questions[0].id');
  }
});

test('branching that references a question that does not exist is rejected', () => {
  const issues = issuesOf(spec([
    { id: 'need', type: 'multiple_choice', title: 'Need?', options: ['Yes', 'No'], required: true },
    text('detail', { visibility: { when: { question: 'ghost', equals: 'Yes' } } }),
  ]));
  const issue = assertIssue(issues, 'unknown_question_reference', 'questions[1].visibility.when.question');
  assert.match(issue.hint, /need/, 'the hint names the real ids');
  const near = assertIssue(issuesOf(spec([
    { id: 'need', type: 'multiple_choice', title: 'Need?', options: ['Yes', 'No'] },
    text('detail', { visibility: { when: { question: 'Need', equals: 'Yes' } } }),
  ])), 'unknown_question_reference');
  assert.match(near.hint, /Did you mean "need"/);
});

test('branching must depend on an earlier, single-answer question and one of its exact options', () => {
  const choice = { id: 'need', type: 'multiple_choice', title: 'Need?', options: ['Yes', 'No'] };
  const when = equals => ({ visibility: { when: { question: 'need', equals } } });
  assertIssue(issuesOf(spec([text('detail', when('Yes')), choice])), 'forward_reference');
  assertIssue(issuesOf(spec([{ ...choice, ...when('Yes') }])), 'self_reference');
  assertIssue(issuesOf(spec([{ id: 'need', type: 'checkboxes', title: 'Need?', options: ['Yes', 'No'] }, text('detail', when('Yes'))])), 'unsupported_condition_source');
  assertIssue(issuesOf(spec([{ id: 'need', type: 'short_text', title: 'Need?' }, text('detail', when('Yes'))])), 'unsupported_condition_source');
  const wrongCase = assertIssue(issuesOf(spec([choice, text('detail', when('yes'))])), 'unknown_option_reference', 'questions[1].visibility.when.equals');
  assert.match(wrongCase.hint, /Did you mean "Yes"/);
  assertIssue(issuesOf(spec([choice, text('detail', when('Maybe'))])), 'unknown_option_reference');
  assert.equal(parseFormSpecification(spec([choice, text('detail', when('Yes'))])).ok, true);
});

test('only "equals" conditions and only the documented visibility shape are accepted', () => {
  const choice = { id: 'need', type: 'multiple_choice', title: 'Need?', options: ['Yes', 'No'] };
  for (const [name, visibility] of [
    ['includes', { when: { question: 'need', includes: 'Yes' } }],
    ['lessThan', { when: { question: 'need', lessThan: 3 } }],
    ['notEquals', { when: { question: 'need', notEquals: 'No' } }],
  ]) {
    assertIssue(issuesOf(spec([choice, text('detail', { visibility })])), 'unsupported_condition_operator', `questions[1].visibility.when.${name}`);
  }
  assertIssue(issuesOf(spec([choice, text('detail', { visibility: 'need' })])), 'visibility_invalid', 'questions[1].visibility');
  assertIssue(issuesOf(spec([choice, text('detail', { visibility: {} })])), 'visibility_invalid', 'questions[1].visibility.when');
  assertIssue(issuesOf(spec([choice, text('detail', { visibility: { when: { equals: 'Yes' } } })])), 'visibility_invalid', 'questions[1].visibility.when.question');
});

test('unknown properties are rejected, so credentials and provider fields cannot ride along', () => {
  const issues = issuesOf({ title: 'T', accessToken: 'SECRET', providerAccountId: 'x', questions: [{ ...text(), label: 'Old name', refreshToken: 'SECRET' }] });
  assertIssue(issues, 'unknown_property', 'accessToken');
  assertIssue(issues, 'unknown_property', 'providerAccountId');
  const label = assertIssue(issues, 'unknown_property', 'questions[0].label');
  assert.match(label.hint, /title/);
  assertIssue(issues, 'unknown_property', 'questions[0].refreshToken');
  assert.doesNotMatch(JSON.stringify(issues), /SECRET/, 'values are never echoed');
  assertIssue(issuesOf({ title: 'T', sections: [], questions: [text()] }), 'unknown_property', 'sections');
});

test('a __proto__ key from JSON is reported, not merged', () => {
  const hostile = JSON.parse('{"title":"T","questions":[{"id":"a","type":"short_text","title":"A","__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}');
  const issues = issuesOf(hostile);
  assertIssue(issues, 'unknown_property');
  assert.equal({}.polluted, undefined);
});

test('the specification and its questions must have the right overall shape', () => {
  for (const input of [null, undefined, 'text', 7, [], true]) assertIssue(issuesOf(input), 'specification_invalid', '');
  assertIssue(issuesOf({ title: 'T' }), 'questions_required', 'questions');
  assertIssue(issuesOf({ title: 'T', questions: [] }), 'questions_required', 'questions');
  assertIssue(issuesOf({ title: 'T', questions: 'nope' }), 'questions_required', 'questions');
  assertIssue(issuesOf({ title: 'T', questions: ['not an object'] }), 'question_invalid', 'questions[0]');
  assertIssue(issuesOf({ title: 'T', questions: Array.from({ length: SPEC_LIMITS.maxQuestions + 1 }, (_, i) => text(`q${i}`)) }), 'too_many_questions', 'questions');
});

test('text is bounded and required fields are not whitespace', () => {
  assertIssue(issuesOf({ title: 'x'.repeat(SPEC_LIMITS.maxFormTitle + 1), questions: [text()] }), 'title_too_long', 'title');
  assertIssue(issuesOf(spec([text('a', { title: '  ' })])), 'question_title_required', 'questions[0].title');
  assertIssue(issuesOf(spec([text('a', { title: 'x'.repeat(SPEC_LIMITS.maxQuestionTitle + 1) })])), 'question_title_too_long', 'questions[0].title');
  assertIssue(issuesOf(spec([text('a', { description: 'x'.repeat(SPEC_LIMITS.maxQuestionDescription + 1) })])), 'description_too_long', 'questions[0].description');
  assertIssue(issuesOf(spec([text('a', { required: 'yes' })])), 'invalid_type', 'questions[0].required');
});

test('whitespace and control characters are normalized without changing meaning', () => {
  const result = parseFormSpecification({
    title: 'Line\none\u0000  two',
    description: 'First line\r\n\r\n\r\n\r\nSecond\u0007 line  ',
    questions: [{ id: 'a', type: 'dropdown', title: ' Pick\tone ', description: '   ', options: [' A  b ', 'C'] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.specification.title, 'Line one two');
  assert.equal(result.specification.description, 'First line\n\nSecond line');
  assert.equal(result.specification.questions[0].title, 'Pick one');
  assert.equal('description' in result.specification.questions[0], false);
  assert.deepEqual(result.specification.questions[0].options, ['A b', 'C']);
});

test('null is treated as absent for optional fields', () => {
  const result = parseFormSpecification({ title: 'T', description: null, questions: [{ id: 'a', type: 'short_text', title: 'A', description: null, options: null, visibility: null, required: null }] });
  assert.equal(result.ok, true);
});

test('validation is pure: the input is not modified and the output is frozen and registered', () => {
  const input = spec([{ id: 'a', type: 'dropdown', title: ' A ', options: ['x', 'y'] }]);
  const before = JSON.stringify(input);
  const result = parseFormSpecification(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.ok, true);
  assert.equal(Object.isFrozen(result.specification), true);
  assert.equal(Object.isFrozen(result.specification.questions[0].options), true);
  assert.equal(isValidatedSpecification(result.specification), true);
  assert.equal(isValidatedSpecification({ ...result.specification }), false, 'a copy is not registered');
  assert.equal(isValidatedSpecification(input), false);
  assert.deepEqual(parseFormSpecification(input), parseFormSpecification(input));
});

test('every issue is machine-readable and the list is bounded', () => {
  const questions = Array.from({ length: 80 }, (_, i) => ({ id: `q${i}`, type: 'nope', title: `Q${i}` }));
  const result = parseFormSpecification({ title: 'T', questions });
  assert.equal(result.ok, false);
  assert.ok(result.issues.length <= 50);
  assert.equal(result.issues.at(-1).code, 'too_many_issues');
  for (const issue of result.issues) {
    assert.equal(typeof issue.code, 'string');
    assert.equal(typeof issue.path, 'string');
    assert.equal(typeof issue.message, 'string');
    assert.ok(issue.message.length > 0);
  }
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('ensureValidatedSpecification throws a structured error for invalid input and passes validated input through', () => {
  assert.throws(
    () => ensureValidatedSpecification({ title: '', questions: [] }),
    error => error instanceof FormEngineError && error.info.code === 'validation_failed' && error.info.outcome === 'not_created' && error.info.issues.length > 0,
  );
  const parsed = parseFormSpecification(spec([text()]));
  assert.equal(ensureValidatedSpecification(parsed.specification), parsed.specification);
  const fromPlain = ensureValidatedSpecification(spec([text()]));
  assert.equal(isValidatedSpecification(fromPlain), true);
});
