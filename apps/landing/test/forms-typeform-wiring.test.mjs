import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { createMemoryDraftStore } from '../server/forms/draft-memory-store.ts';
import { createMemoryFormStore } from '../server/forms/memory-store.ts';
import { createFormEngine, extractFormTarget } from '../server/forms/engine.ts';
import { createFormsProviders } from '../server/forms/providers/index.ts';
import { createFormDraftRouter } from '../server/forms/interpretation/routes.ts';
import { createFormsRouter } from '../server/forms/routes.ts';
import { assessInterpretation } from '../server/forms/interpretation/interpreter.ts';
import { createTypeformClient } from '../server/forms/providers/typeform/client.ts';
import { createTypeformWorld } from './forms-typeform-adapter.test.mjs';
import { ORIGIN } from './helpers/forms-harness.mjs';

const Q = (id, title, type = 'short_text', extra = {}) => ({ id, title, description: null, type, required: true, options: [], visibility: null, ...extra });
const SPEC = () => ({ title: 'Conference registration', description: 'Register for the day.', questions: [
  Q('full_name', 'Full name'),
  Q('email', 'Email address', 'email'),
  Q('ticket', 'Ticket type', 'multiple_choice', { options: ['Standard', 'Student'] }),
] });
const ready = (spec = SPEC()) => ({ status: 'ready', specification: spec, assumptions: ['Name and email are required.'], question: null, explanation: null });

/**
 * The real draft router, the real form engine and the real Typeform adapter, with a stateful fake of
 * the Typeform API at the fetch boundary. Nothing about the wiring is stubbed: the request goes
 * browser-shaped JSON → interpretation → draft → claim → adapter → Typeform HTTP → form record.
 */
async function boot(options = {}) {
  const typeform = createTypeformWorld();
  const env = typeform.env;
  const providers = createFormsProviders({
    env,
    typeform: {
      getConnection: (userId, provider) => typeform.service.getAuthorizedConnection(userId, provider),
      reportAuthorizationRejected: (userId, provider) => typeform.service.reportAuthorizationRejected(userId, provider),
      client: createTypeformClient({ fetchImpl: typeform.fake.fetch }),
    },
  });
  const store = createMemoryFormStore();
  const engine = createFormEngine({ providers, store, log: typeform.log, now: typeform.now });
  const drafts = createMemoryDraftStore();
  const inputs = [];
  const interpreter = {
    async interpret(input) {
      inputs.push(structuredClone(input));
      return options.interpret ? options.interpret(input, inputs.length) : ready();
    },
  };
  const person = { id: 'user-a', email: 'ada@example.test', name: 'Ada' };
  const app = express();
  app.use('/api/forms', createFormDraftRouter({
    store: drafts, engine, interpreter, env, log: typeform.log, now: typeform.now,
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(drafts.all().length + 1).padStart(12, '0')}`,
    getSession: async () => person,
  }));
  app.use('/api/forms', createFormsRouter({ engine, env, log: typeform.log, getSession: async () => person }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;
  async function call(method, path, data) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(method !== 'GET' ? { origin: ORIGIN, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 204 */ }
    return { status: response.status, json, text };
  }
  return {
    typeform, store, drafts, inputs, call,
    interpret: data => call('POST', '/interpret', data),
    revise: data => call('POST', '/revise', data),
    confirm: data => call('POST', '/confirm', data),
    async close() { await new Promise(resolve => server.close(resolve)); },
  };
}
async function withApp(run) {
  const app = await boot();
  try { return await run(app); } finally { await app.close(); }
}

test('a Typeform draft is planned, stored and created in Typeform — never in Google', () => withApp(async app => {
  await app.typeform.connect('user-a');
  const created = await app.interpret({ provider: 'typeform', request: 'Register people for our conference.' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.draft.provider, 'typeform', 'the provider is recorded on the draft');
  assert.equal(app.inputs[0].provider, 'typeform', 'interpretation planned against Typeform');
  assert.equal(app.typeform.fake.calls.length, 0, 'nothing is created before confirmation');
  assert.equal(app.store.all().length, 0);

  const response = await app.confirm({ draftId: created.json.draft.id, version: 1, confirm: true });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.draft.status, 'created');
  assert.equal(response.json.form.provider, 'typeform');
  assert.match(response.json.form.responderUrl, /^https:\/\/form\.typeform\.com\/to\//);
  assert.match(response.json.form.editUrl, /^https:\/\/admin\.typeform\.com\/form\//);
  assert.equal(app.typeform.fake.callsTo('forms.create').length, 1);
  assert.equal(app.store.all()[0].provider, 'typeform');
  assert.equal(app.store.all()[0].externalAccountId, 'typeform-account-of-user-a');
  assert.equal(app.typeform.fake.lastForm().title, 'Conference registration');
}));

test('an unconnected Typeform fails creation with a provider-specific refusal and keeps the draft', () => withApp(async app => {
  const created = await app.interpret({ provider: 'typeform', request: 'Register people.' });
  assert.equal(created.status, 201, created.text);
  const response = await app.confirm({ draftId: created.json.draft.id, version: 1, confirm: true });
  assert.equal(response.status, 409, response.text);
  assert.equal(response.json.code, 'provider_not_connected');
  assert.equal(app.typeform.fake.calls.length, 0, 'no token, no request');
  const reloaded = await app.call('GET', `/draft/${created.json.draft.id}`);
  assert.equal(reloaded.json.draft.status, 'ready', 'a definitive not-created failure releases the draft');
  assert.equal(reloaded.json.draft.provider, 'typeform');
}));

test('revisions stay bound to the draft provider and Microsoft is never a creation target', () => withApp(async app => {
  const created = await app.interpret({ provider: 'typeform', request: 'Register people.' });
  const revised = await app.revise({ draftId: created.json.draft.id, version: 1, request: 'Make email optional.' });
  assert.equal(revised.status, 200, revised.text);
  assert.equal(app.inputs[1].provider, 'typeform');
  assert.equal(revised.json.draft.provider, 'typeform');

  const refused = await app.interpret({ provider: 'microsoft', request: 'Register people.' });
  assert.equal(refused.status, 501, 'a connectable provider without a Forms API is not a creation target');
  assert.equal(refused.json.code, 'provider_not_supported');
  assert.match(refused.json.error, /Google Forms or Typeform/);

  const unknown = await app.interpret({ provider: 'airtable', request: 'Register people.' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.code, 'provider_not_supported');
}));

test('the ready gate uses the target provider planner, not Google’s', () => {
  // Two adjacent conditional groups: Google Forms cannot lay this out; Typeform has no such rule.
  const spec = {
    title: 'Branching',
    questions: [
      Q('needs', 'Need accommodation?', 'multiple_choice', { options: ['Yes', 'No'] }),
      Q('nights', 'How many nights?', 'short_text', { visibility: { when: { question: 'needs', equals: 'Yes' } } }),
      Q('talk', 'Giving a talk?', 'multiple_choice', { options: ['Yes', 'No'] }),
      Q('topic', 'Talk title', 'short_text', { visibility: { when: { question: 'talk', equals: 'Yes' } } }),
    ],
  };
  const value = { status: 'ready', specification: spec, assumptions: [], question: null, explanation: null };
  const google = assessInterpretation(value, 'google');
  const typeform = assessInterpretation(value, 'typeform');
  assert.equal(typeform.status, 'ready', 'Typeform can express the same routing');
  assert.ok(['ready', 'unsupported'].includes(google.status));
  if (google.status === 'unsupported') {
    assert.match(google.explanation, /section|branch|routing|follow/i, 'the Google refusal stays honest about layout');
  }
});

test('share URLs are mapped to the right provider, and unsupported URLs are refused', () => {
  assert.deepEqual(extractFormTarget('https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit'), { provider: 'google', formId: '1FAfakeForm0001abcdefghijklmnop' });
  assert.deepEqual(extractFormTarget('https://form.typeform.com/to/abc123xyz'), { provider: 'typeform', formId: 'abc123xyz' });
  assert.deepEqual(extractFormTarget('https://admin.typeform.com/form/abc123xyz/edit'), { provider: 'typeform', formId: 'abc123xyz' });
  for (const bad of [
    'https://form.typeform.com/to/', 'http://form.typeform.com/to/abc123xyz', 'https://form.typeform.com/to/abc123xyz?x=1',
    'https://typeform.com/to/abc123xyz', 'https://evil.example/to/abc123xyz', 'javascript:alert(1)', '',
  ]) assert.equal(extractFormTarget(bad), null, bad);
});

test('importing a Typeform adds a Typeform record and still accepts Google URLs', () => withApp(async app => {
  await app.typeform.connect('user-a');
  const seeded = await app.typeform.provider.createForm('user-a', SPEC(), { requestId: 'req_seed', log: app.typeform.log });

  const imported = await app.call('POST', '/library/import', { url: `https://form.typeform.com/to/${seeded.providerFormId}` });
  assert.equal(imported.status, 201, imported.text);
  assert.equal(imported.json.form.provider, 'typeform');
  assert.equal(imported.json.form.providerFormId, seeded.providerFormId);
  const record = app.store.all().find(form => form.provider === 'typeform');
  assert.ok(record);
  assert.equal(record.source, 'imported');

  const invalid = await app.call('POST', '/library/import', { url: 'https://example.com/form/123' });
  assert.equal(invalid.status, 400, invalid.text);
  assert.match(invalid.json.error, /Typeform/);
}));

test('the Typeform migration widens provider checks without rewriting rows', async () => {
  const sql = await readFile(new URL('../db/migrations/019_typeform_provider.sql', import.meta.url), 'utf8');
  const bare = sql.replace(/--.*$/gm, '');
  assert.match(bare, /provider_connection ADD CONSTRAINT provider_connection_provider_check/);
  assert.match(bare, /CHECK \(provider IN \('google', 'microsoft', 'typeform'\)\)/);
  assert.match(bare, /form_draft ADD CONSTRAINT form_draft_provider_check/);
  assert.match(bare, /CHECK \(provider IN \('google', 'typeform'\)\)/);
  assert.doesNotMatch(bare, /form_edit_draft/, 'editing stays Google-only');
  assert.doesNotMatch(bare, /\b(DELETE|TRUNCATE|UPDATE)\b/i);
  assert.doesNotMatch(bare, /\bDROP TABLE\b/i);
});
