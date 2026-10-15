import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResponses, topPhrases } from '../server/forms/insights/summary.ts';

const QUESTIONS = [
  { id: 'q1', title: 'How satisfied?', kind: 'scale' },
  { id: 'q2', title: 'Choose color', kind: 'choice', options: ['Red', 'Blue', 'Green'] },
  { id: 'q3', title: 'Any comments?', kind: 'text' },
];

const ANSWERS = [
  { q1: ['5'], q2: ['Red'], q3: ['Great product'] },
  { q1: ['4'], q2: ['Blue'], q3: ['Could be better'] },
  { q1: ['5'], q2: ['Red'], q3: ['Love it'] },
  { q1: ['3'], q2: ['Green'], q3: ['Okay'] },
  { q1: ['4'], q2: ['Blue'], q3: ['Good'] },
];

test('summarizeResponses computes total responses and per-question summaries', () => {
  const summary = summarizeResponses(QUESTIONS, ANSWERS);
  assert.equal(summary.totalResponses, 5);
  assert.equal(summary.truncated, false);
  assert.equal(summary.questions.length, 3);
});

test('scale questions get average of numeric answers', () => {
  const summary = summarizeResponses(QUESTIONS, ANSWERS);
  const q1 = summary.questions.find(q => q.id === 'q1');
  assert.ok(q1);
  assert.equal(q1.kind, 'scale');
  assert.equal(q1.answered, 5);
  assert.ok(q1.average !== undefined);
  assert.equal(q1.average, 4.2);
});

test('choice questions get counts for each option', () => {
  const summary = summarizeResponses(QUESTIONS, ANSWERS);
  const q2 = summary.questions.find(q => q.id === 'q2');
  assert.ok(q2);
  assert.equal(q2.kind, 'choice');
  assert.equal(q2.answered, 5);
  assert.deepEqual(q2.choices?.map(c => c.label).sort(), ['Blue', 'Green', 'Red']);
  const red = q2.choices?.find(c => c.label === 'Red');
  const blue = q2.choices?.find(c => c.label === 'Blue');
  const green = q2.choices?.find(c => c.label === 'Green');
  assert.equal(red?.count, 2);
  assert.equal(blue?.count, 2);
  assert.equal(green?.count, 1);
});

test('text questions get top phrases from answers', () => {
  const summary = summarizeResponses(QUESTIONS, ANSWERS);
  const q3 = summary.questions.find(q => q.id === 'q3');
  assert.ok(q3);
  assert.equal(q3.kind, 'text');
  assert.equal(q3.answered, 5);
  assert.ok(q3.topPhrases !== undefined);
});

test('unknown question ids in answers are ignored', () => {
  const answersWithUnknown = [...ANSWERS, { q99: ['ignored'] }];
  const summary = summarizeResponses(QUESTIONS, answersWithUnknown);
  assert.equal(summary.totalResponses, 6);
});

test('empty answers are not counted', () => {
  const answersWithEmpty = [...ANSWERS, { q1: [''] }, { q1: ['   '] }];
  const summary = summarizeResponses(QUESTIONS, answersWithEmpty);
  assert.equal(summary.totalResponses, 7);
  const q1 = summary.questions.find(q => q.id === 'q1');
  assert.equal(q1?.answered, 5);
});

test('non-numeric scale answers are ignored in average', () => {
  const answers = [{ q1: ['5'] }, { q1: ['not a number'] }, { q1: ['3'] }];
  const summary = summarizeResponses([QUESTIONS[0]], answers);
  const q1 = summary.questions[0];
  assert.equal(q1.answered, 3);
  assert.equal(q1.average, 4);
});

test('topPhrases extracts most common words, excludes stopwords and short words', () => {
  const texts = [
    'This product is amazing and wonderful',
    'Amazing product really great',
    'Product is good and useful',
  ];
  const phrases = topPhrases(texts, 3);
  assert.ok(phrases.length > 0);
  const top = phrases[0].phrase;
  assert.ok(['amazing', 'product'].includes(top));
  assert.ok(!phrases.some(p => ['the', 'and', 'is', 'is'].includes(p.phrase)));
});

test('topPhrases filters words shorter than 3 chars', () => {
  const texts = ['a an the to of in'];
  const phrases = topPhrases(texts, 5);
  assert.equal(phrases.length, 0);
});

test('topPhrases filters numeric words', () => {
  const texts = ['version 2 3 4 five'];
  const phrases = topPhrases(texts, 5);
  assert.ok(!phrases.some(p => /^\d+$/.test(p.phrase)));
});

test('summarizeResponses handles answers with extra options not in question definition', () => {
  const questions = [{ id: 'q1', title: 'Color', kind: 'choice', options: ['Red', 'Blue'] }];
  const answers = [{ q1: ['Red'] }, { q1: ['Blue'] }, { q1: ['Green'] }];
  const summary = summarizeResponses(questions, answers);
  const q1 = summary.questions[0];
  assert.ok(q1.choices?.some(c => c.label === 'Green'));
  const green = q1.choices?.find(c => c.label === 'Green');
  assert.equal(green?.count, 1);
});

test('summarizeResponses with no answers returns zero totals', () => {
  const summary = summarizeResponses(QUESTIONS, []);
  assert.equal(summary.totalResponses, 0);
  assert.ok(summary.questions.every(q => q.answered === 0));
});

test('summarizeResponses respects answer count per question, not total responses', () => {
  const answers = [
    { q1: ['5'], q2: ['Red'] },
    { q1: ['4'] },
    { q2: ['Blue'] },
  ];
  const summary = summarizeResponses(QUESTIONS, answers);
  const q1 = summary.questions.find(q => q.id === 'q1');
  const q2 = summary.questions.find(q => q.id === 'q2');
  assert.equal(summary.totalResponses, 3);
  assert.equal(q1?.answered, 2);
  assert.equal(q2?.answered, 2);
});