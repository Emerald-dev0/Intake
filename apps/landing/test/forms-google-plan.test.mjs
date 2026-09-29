import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialBatch, buildRoutingBatch, countQuestions, hasDeferredRouting, planGoogleForm } from '../server/forms/providers/google/plan.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';
import { answerCombinations, expectedVisibleTitles, simulateRespondent } from './helpers/google-forms-fake.mjs';
import { createGoogleForm, createWorld, form, shortText, when, yesNo } from './helpers/forms-harness.mjs';

function planOf(input) {
  const parsed = parseFormSpecification(input);
  assert.equal(parsed.ok, true, `fixture should be a valid specification: ${JSON.stringify(parsed.issues ?? [])}`);
  return planGoogleForm(parsed.specification);
}

function planIssues(input) {
  const planned = planOf(input);
  assert.equal(planned.ok, false, 'expected Google to be unable to express this form');
  return planned.issues;
}

/** Build a specification through the real adapter into the stateful fake and return what Google now holds. */
async function build(input) {
  const world = createWorld();
  await world.connect('user-a');
  await createGoogleForm(world, input);
  return { world, googleForm: world.fake.lastForm() };
}

const LAYOUTS = {
  'a conditional group in the middle of the form (Yes goes in, No skips to the rest)': form([
    shortText('name', { required: true }),
    yesNo(),
    shortText('nights', { title: 'How many nights?', ...when('need', 'Yes') }),
    shortText('budget', { title: 'Budget?', ...when('need', 'Yes') }),
    shortText('contact', { title: 'Contact number' }),
  ]),
  'a conditional group at the end of the form (No submits)': form([shortText('name'), yesNo(), shortText('nights', { title: 'How many nights?', ...when('need', 'Yes') })]),
  'a dropdown with three answers where only one shows the group': form([
    { id: 'attending', type: 'dropdown', title: 'Attending?', options: ['Yes', 'No', 'Maybe'], required: true },
    shortText('guest', { title: 'Guest name', ...when('attending', 'Yes') }),
    shortText('diet', { title: 'Dietary needs' }),
  ]),
  'two independent conditional groups': form([
    yesNo({ id: 'first', title: 'First?' }),
    shortText('a', { title: 'A', ...when('first', 'Yes') }),
    shortText('between', { title: 'Between' }),
    yesNo({ id: 'second', title: 'Second?' }),
    shortText('b', { title: 'B', ...when('second', 'Yes') }),
    shortText('end', { title: 'End' }),
  ]),
  'questions that share a page with the controlling question': form([
    yesNo(),
    shortText('always', { title: 'Always on that page' }),
    shortText('extra', { title: 'Extra', ...when('need', 'Yes') }),
    shortText('after', { title: 'After' }),
  ]),
  'a trigger answer that is not the first option': form([
    { id: 'kind', type: 'multiple_choice', title: 'Kind?', options: ['Other', 'Student', 'Staff'], required: true },
    shortText('id', { title: 'Student id', ...when('kind', 'Student') }),
    shortText('done', { title: 'Done' }),
  ]),
  'the controlling question is the very first question': form([yesNo(), shortText('a', { title: 'A', ...when('need', 'Yes') }), shortText('b', { title: 'B' })]),
  'no conditions at all': form([shortText('a', { title: 'A' }), yesNo({ id: 'b', title: 'B' }), { id: 'c', type: 'checkboxes', title: 'C', options: ['x', 'y'] }]),
};

test('a form Google builds behaves like the specification for every combination of answers', async () => {
  for (const [name, input] of Object.entries(LAYOUTS)) {
    const parsed = parseFormSpecification(input);
    assert.equal(parsed.ok, true, name);
    const { googleForm } = await build(input);
    const combinations = answerCombinations(parsed.specification);
    assert.ok(combinations.length >= 1);
    for (const answers of combinations) {
      assert.deepEqual(
        simulateRespondent(googleForm.items, answers),
        expectedVisibleTitles(parsed.specification, answers),
        `${name}: answers ${JSON.stringify(answers)}`,
      );
    }
  }
});

test('the built form is structurally sound in every layout', async () => {
  for (const [name, input] of Object.entries(LAYOUTS)) {
    const { googleForm } = await build(input);
    const { items } = googleForm;
    assert.equal(items[0].pageBreakItem, undefined, `${name}: the first item is a question`);
    assert.equal(new Set(items.map(item => item.itemId)).size, items.length, `${name}: item ids are unique`);
    const headers = new Set(items.filter(item => item.pageBreakItem).map(item => item.itemId));
    for (const item of items) {
      const choice = item.questionItem?.question?.choiceQuestion;
      if (!choice) continue;
      for (const option of choice.options) {
        if (option.goToSectionId) assert.ok(headers.has(option.goToSectionId), `${name}: routes only to sections that exist`);
        if (option.goToSectionId || option.goToAction) assert.notEqual(choice.type, 'CHECKBOX', `${name}: checkboxes never route`);
      }
    }
    assert.equal(googleForm.items.filter(item => item.questionItem).length, input.questions.length, `${name}: every question was created`);
  }
});

test('a group at the end of the form routes with actions only, in a single batch', async () => {
  const input = LAYOUTS['a conditional group at the end of the form (No submits)'];
  const planned = planOf(input);
  assert.equal(planned.ok, true);
  assert.equal(hasDeferredRouting(planned.plan), false);
  const { requests } = buildInitialBatch(planned.plan);
  const options = requests.map(request => request.createItem?.item.questionItem?.question.choiceQuestion?.options).find(Boolean);
  assert.deepEqual(options, [{ value: 'Yes', goToAction: 'NEXT_SECTION' }, { value: 'No', goToAction: 'SUBMIT_FORM' }]);
});

test('a group in the middle builds the whole structure first, then swaps in the routed question', async () => {
  const input = LAYOUTS['a conditional group in the middle of the form (Yes goes in, No skips to the rest)'];
  const planned = planOf(input);
  assert.equal(planned.ok, true);
  assert.equal(hasDeferredRouting(planned.plan), true);

  // Batch 1 is the complete final structure. The routing question is in place but plain, because the
  // section it must name does not exist until this batch is applied.
  const first = buildInitialBatch(planned.plan);
  const created = first.requests.filter(request => request.createItem).map(request => request.createItem.item);
  assert.equal(created.length, planned.plan.items.length);
  assert.equal(JSON.stringify(first.requests).includes('goTo'), false, 'nothing routes before the sections exist');
  const plain = created.find(item => item.title === 'Do you need accommodation?');
  assert.deepEqual(plain.questionItem.question.choiceQuestion.options, [{ value: 'Yes' }, { value: 'No' }]);

  // Batch 2 creates the routed version at the same position, which pushes the plain copy one place
  // down, then deletes the plain copy. Only createItem and deleteItem are involved.
  const second = buildRoutingBatch(planned.plan, new Map([['section_1', 'aaaa1111'], ['section_2', 'bbbb2222']]));
  assert.equal(second.length, 2);
  assert.equal(second[0].createItem.location.index, 1);
  assert.deepEqual(second[0].createItem.item.questionItem.question.choiceQuestion.options, [
    { value: 'Yes', goToAction: 'NEXT_SECTION' },
    { value: 'No', goToSectionId: 'bbbb2222' },
  ]);
  assert.deepEqual(second[1], { deleteItem: { location: { index: 2 } } });
});

test('the first batch never produces a shape Google might refuse: a page break first or an empty section', () => {
  for (const [name, input] of Object.entries(LAYOUTS)) {
    const planned = planOf(input);
    assert.equal(planned.ok, true, name);
    const kinds = buildInitialBatch(planned.plan).requests.filter(request => request.createItem).map(request => (request.createItem.item.pageBreakItem ? 'break' : 'question'));
    assert.equal(kinds[0], 'question', `${name}: starts with a question`);
    assert.equal(kinds.at(-1), 'question', `${name}: ends with a question`);
    assert.equal(kinds.join(',').includes('break,break'), false, `${name}: no empty section`);
  }
});

test('the second batch keeps every other question where it was', async () => {
  const input = LAYOUTS['two independent conditional groups'];
  const parsed = parseFormSpecification(input);
  const { googleForm } = await build(input);
  assert.deepEqual(
    googleForm.items.filter(item => item.questionItem).map(item => item.title),
    parsed.specification.questions.map(question => question.title),
    'same questions, same order, none duplicated',
  );
});

test('question types map to the Google question kinds that behave the same', async () => {
  const input = form([
    { id: 'a', type: 'short_text', title: 'Short', required: true, description: 'Help text' },
    { id: 'b', type: 'long_text', title: 'Long' },
    { id: 'c', type: 'email', title: 'Email' },
    { id: 'd', type: 'multiple_choice', title: 'Radio', options: ['x', 'y'] },
    { id: 'e', type: 'dropdown', title: 'Drop', options: ['x', 'y'] },
    { id: 'f', type: 'checkboxes', title: 'Boxes', options: ['x', 'y'], required: true },
  ], { description: 'About this form' });
  const { googleForm } = await build(input);
  const [short, long, email, radio, drop, boxes] = googleForm.items;
  assert.deepEqual(short.questionItem.question.textQuestion, { paragraph: false });
  assert.equal(short.questionItem.question.required, true);
  assert.equal(short.description, 'Help text');
  assert.deepEqual(long.questionItem.question.textQuestion, { paragraph: true });
  assert.equal(long.questionItem.question.required, undefined, 'optional questions send no required flag');
  assert.deepEqual(email.questionItem.question.textQuestion, { paragraph: false });
  assert.equal(radio.questionItem.question.choiceQuestion.type, 'RADIO');
  assert.equal(drop.questionItem.question.choiceQuestion.type, 'DROP_DOWN');
  assert.equal(boxes.questionItem.question.choiceQuestion.type, 'CHECKBOX');
  assert.deepEqual(boxes.questionItem.question.choiceQuestion.options, [{ value: 'x' }, { value: 'y' }]);
  assert.equal(googleForm.info.description, 'About this form');
  assert.equal(googleForm.info.title, 'Registration');
});

test('email questions are created as short answer and the loss of validation is reported', () => {
  const planned = planOf(form([{ id: 'mail', type: 'email', title: 'Your email' }]));
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan.warnings.map(warning => [warning.code, warning.questionId]), [['email_validation_unavailable', 'mail']]);
  assert.match(planned.plan.warnings[0].message, /Google Forms API cannot turn on email validation/);
});

test('item positions start at an explicit zero and are consecutive', () => {
  const planned = planOf(LAYOUTS['two independent conditional groups']);
  assert.equal(planned.ok, true);
  const { requests } = buildInitialBatch(planned.plan);
  const indexes = requests.filter(request => request.createItem).map(request => request.createItem.location.index);
  assert.deepEqual(indexes, indexes.map((_, position) => position));
  assert.equal(indexes[0], 0);
  assert.match(JSON.stringify(requests[0]), /"location":\{"index":0\}/, 'index 0 survives JSON serialization');
});

test('the description is set with an update mask, and only when there is one', () => {
  const withDescription = planOf(form([shortText('a')], { description: 'Hello' }));
  assert.equal(withDescription.ok, true);
  assert.deepEqual(buildInitialBatch(withDescription.plan).requests[0], { updateFormInfo: { info: { description: 'Hello' }, updateMask: 'description' } });
  const without = planOf(form([shortText('a')]));
  assert.equal(without.ok, true);
  assert.equal(buildInitialBatch(without.plan).requests.some(request => request.updateFormInfo), false);
  assert.equal(countQuestions(without.plan), 1);
});

test('planning is pure: same result every time, and the specification is not touched', () => {
  const parsed = parseFormSpecification(LAYOUTS['a conditional group in the middle of the form (Yes goes in, No skips to the rest)']);
  assert.equal(parsed.ok, true);
  assert.deepEqual(planGoogleForm(parsed.specification), planGoogleForm(parsed.specification));
  assert.equal(Object.isFrozen(parsed.specification), true, 'planning ran on a frozen specification without throwing');
});

test('layouts Google routing cannot express are refused with an explanation, not built differently', () => {
  const nested = planIssues(form([
    yesNo(),
    { id: 'kind', type: 'multiple_choice', title: 'Kind?', options: ['A', 'B'], ...when('need', 'Yes') },
    shortText('detail', when('kind', 'A')),
  ]));
  assert.ok(nested.some(issue => issue.code === 'google_nested_condition' && issue.path === 'questions[2].visibility'));

  const bothBranches = planIssues(form([yesNo(), shortText('a', when('need', 'Yes')), shortText('b', when('need', 'No'))]));
  assert.ok(bothBranches.some(issue => issue.code === 'google_condition_placement' && issue.path === 'questions[2].visibility'));
  assert.match(bothBranches[0].hint, /same condition|directly before/);

  const separated = planIssues(form([yesNo(), shortText('a', when('need', 'Yes')), shortText('middle'), shortText('b', when('need', 'Yes'))]));
  assert.ok(separated.some(issue => issue.code === 'google_condition_placement' && issue.path === 'questions[3].visibility'));

  const optional = planIssues(form([yesNo({ required: false }), shortText('a', when('need', 'Yes'))]));
  const missing = optional.find(issue => issue.code === 'google_condition_source_not_required');
  assert.ok(missing);
  assert.equal(missing.path, 'questions[0].required');
  assert.match(missing.hint, /"required": true/);
});

test('every refusal explains itself in plain language', () => {
  const issues = [
    ...planIssues(form([yesNo({ required: false }), shortText('a', when('need', 'Yes'))])),
    ...planIssues(form([yesNo(), shortText('a', when('need', 'Yes')), shortText('b', when('need', 'No'))])),
  ];
  for (const issue of issues) {
    assert.ok(issue.message.length > 40, issue.message);
    assert.ok(issue.hint && issue.hint.length > 10);
    assert.match(issue.path, /^questions\[\d+\]\./);
  }
});

test('planning requires a validated specification and does not guess', () => {
  assert.throws(() => planGoogleForm({ title: 'T', questions: [{ id: 'a', type: 'short_text', title: 'A', required: false, visibility: { when: { question: 'ghost', equals: 'x' } } }] }), /validated specification/);
});
