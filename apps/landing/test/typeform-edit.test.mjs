import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileTypeformEdit, refuseUnsafeTypeformOperation, typeformEditSnapshot, typeformUnchanged, verifyTypeformEdit,
} from '../server/forms/providers/typeform/edit.ts';
import { createTypeformProvider } from '../server/forms/providers/typeform/adapter.ts';

/**
 * Typeform editing is a read-modify-write: the whole form goes back in one PUT. That makes the
 * payload the safety mechanism, so these tests are about what is *preserved*, not only what changes.
 */

const resource = () => ({
  id: 'JiLEvIgv', title: 'Workshop sign-up', type: 'form',
  settings: { language: 'en', isPublic: true, autosaveProgress: true, progressBar: 'percentage',
    showTypeformBranding: true, meta: { allowIndexing: false }, redirectAfterSubmitUrl: 'https://example.test/thanks' },
  theme: { id: 'theme-1', name: 'Default' },
  fields: [
    { id: 'f1', ref: 'name', title: 'Full name', type: 'short_text', properties: {}, validations: { required: true } },
    { id: 'f2', ref: 'diet', title: 'Dietary needs', type: 'long_text', properties: { description: 'Anything we should know' }, validations: { required: false } },
    { id: 'f3', ref: 'slot', title: 'Which session?', type: 'multiple_choice',
      properties: { choices: [{ label: 'Morning' }, { label: 'Afternoon' }] }, validations: { required: true } },
  ],
  logic: [],
  welcomeScreens: [{ ref: 'welcome', title: 'Workshop sign-up', properties: { showButton: true, buttonText: 'Start', description: 'Sign up for the workshop.' } }],
  thankYouScreens: [{ ref: 'ty', title: 'Thanks', properties: { showButton: false, buttonText: '', buttonMode: 'close' } }],
  _links: { display: 'https://form.typeform.com/to/JiLEvIgv', edit: 'https://admin.typeform.com/form/JiLEvIgv/edit' },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  workspace: { id: 'ws-1', name: 'Personal' },
});

const withLogic = () => {
  const value = resource();
  value.logic = [{ ref: 'slot', type: 'field', actions: [{ action: 'jump', details: { to: { type: 'field', value: 'diet' }, condition: { op: 'is', value: 'Morning' } } }] }];
  return value;
};

test('the snapshot advertises only what Typeform can do safely', () => {
  const snapshot = typeformEditSnapshot(resource());
  assert.equal(snapshot.providerFormId, 'JiLEvIgv');
  assert.equal(snapshot.title, 'Workshop sign-up');
  assert.equal(snapshot.description, 'Sign up for the workshop.', 'the visible description lives on the welcome screen');
  assert.equal(snapshot.revisionId, '2026-01-02T00:00:00Z');
  assert.equal(snapshot.items.length, 3);
  assert.deepEqual(snapshot.items[2].options, ['Morning', 'Afternoon']);
  for (const item of snapshot.items) {
    assert.equal(item.capabilities.includes('delete'), false, 'deleting a field destroys its answers; never offered');
    assert.equal(item.capabilities.includes('update_type'), false, 'Typeform cannot retype a field in place');
  }
  assert.equal(snapshot.items[0].capabilities.includes('move'), true, 'a form without logic can be reordered');

  const routed = typeformEditSnapshot(withLogic());
  assert.equal(routed.hasBranching, true);
  assert.equal(routed.items[0].capabilities.includes('move'), false, 'order is part of the flow when jumps exist');
  assert.equal(routed.items[2].hasRouting, true);
});

test('a compiled payload echoes everything the plan did not name', () => {
  const live = resource();
  const { payload, expected } = compileTypeformEdit(live, {
    formId: 'JiLEvIgv', summary: 'Rename the form and make dietary needs required',
    operations: [
      { type: 'update_title', title: 'Workshop sign-up 2027' },
      { type: 'update_question', questionId: 'diet', changes: { required: true, title: 'Dietary requirements' } },
      { type: 'update_question', questionId: 'slot', changes: { options: ['Morning', 'Afternoon', 'Evening'] } },
      { type: 'add_question', question: { title: 'Anything else?', type: 'long_text', required: false } },
    ],
  });

  assert.equal(payload.title, 'Workshop sign-up 2027');
  assert.equal(payload.fields.length, 4);
  assert.equal(payload.fields[0].id, 'f1', 'untouched fields keep their provider ids');
  assert.equal(payload.fields[0].ref, 'name');
  assert.equal(payload.fields[1].title, 'Dietary requirements');
  assert.equal(payload.fields[1].validations.required, true);
  assert.equal(payload.fields[1].properties.description, 'Anything we should know', 'an unnamed property survives');
  assert.deepEqual(payload.fields[2].properties.choices, [{ label: 'Morning' }, { label: 'Afternoon' }, { label: 'Evening' }]);
  assert.equal(payload.fields[3].id, undefined, 'a new field is created by Typeform, not by Intake');

  // The parts a naive rewrite would silently drop.
  assert.deepEqual(payload.settings, live.settings);
  assert.deepEqual(payload.logic, live.logic);
  assert.deepEqual(payload.welcome_screens, live.welcomeScreens);
  assert.deepEqual(payload.thankyou_screens, live.thankYouScreens);
  assert.deepEqual(payload.theme, { href: 'https://api.typeform.com/themes/theme-1' });
  assert.equal('id' in payload, false, 'provider identity is the URL, not the body');
  assert.equal('_links' in payload, false);
  assert.equal('workspace' in payload, false);
  assert.equal('created_at' in payload, false);

  assert.equal(expected.title, 'Workshop sign-up 2027');
  assert.equal(expected.items[1].required, true);
});

test('a form description is written to the welcome screen it came from', () => {
  const { payload } = compileTypeformEdit(resource(), {
    formId: 'JiLEvIgv', summary: 'Rewrite the welcome text',
    operations: [{ type: 'update_description', description: 'Two minutes, four questions.' }],
  });
  assert.equal(payload.welcome_screens[0].properties.description, 'Two minutes, four questions.');
  assert.equal(payload.welcome_screens[0].title, 'Workshop sign-up', 'the rest of the screen is untouched');
});

test('reordering moves the field, not the ids', () => {
  const { payload } = compileTypeformEdit(resource(), {
    formId: 'JiLEvIgv', summary: 'Ask for the session first',
    operations: [{ type: 'move_question', questionId: 'slot', position: 0 }],
  });
  assert.deepEqual(payload.fields.map(field => field.id), ['f3', 'f1', 'f2']);
});

test('unsafe operations are refused by name, before anything is built', () => {
  const deletePlan = { formId: 'JiLEvIgv', summary: 'Remove a question', operations: [{ type: 'delete_question', questionId: 'f2' }] };
  assert.match(refuseUnsafeTypeformOperation(resource(), deletePlan), /destroys|answers|delete it in Typeform/i);
  assert.throws(() => compileTypeformEdit(resource(), deletePlan), /Typeform cannot delete/i);

  const retypePlan = { formId: 'JiLEvIgv', summary: 'Make it a dropdown', operations: [{ type: 'update_question', questionId: 'f3', changes: { type: 'dropdown' } }] };
  assert.match(refuseUnsafeTypeformOperation(resource(), retypePlan), /cannot change a question.s type/i);

  const moveWithLogic = { formId: 'JiLEvIgv', summary: 'Move it', operations: [{ type: 'move_question', questionId: 'diet', position: 0 }] };
  assert.match(refuseUnsafeTypeformOperation(withLogic(), moveWithLogic), /logic jumps/i);

  const missing = { formId: 'JiLEvIgv', summary: 'Rename a question', operations: [{ type: 'update_question', questionId: 'gone', changes: { title: 'Nope' } }] };
  assert.match(refuseUnsafeTypeformOperation(resource(), missing), /no longer exists/i);
});

test('verification separates a lost field from a value that did not change', () => {
  const before = resource();
  const plan = { formId: 'JiLEvIgv', summary: 'Rename the form', operations: [{ type: 'update_title', title: 'Workshop sign-up 2027' }] };
  const { expected } = compileTypeformEdit(before, plan);

  const good = { ...before, title: 'Workshop sign-up 2027', updatedAt: '2026-01-03T00:00:00Z' };
  assert.deepEqual(verifyTypeformEdit(before, good, expected, plan), { ok: true });

  const lost = { ...good, fields: before.fields.slice(0, 2) };
  assert.equal(verifyTypeformEdit(before, lost, expected, plan).reason, 'missing_fields');

  const unchanged = { ...before, updatedAt: '2026-01-03T00:00:00Z' };
  assert.equal(verifyTypeformEdit(before, unchanged, expected, plan).reason, 'value_mismatch');
});

test('the snapshot comparison notices a change made elsewhere', () => {
  const base = typeformEditSnapshot(resource());
  assert.equal(typeformUnchanged(base, typeformEditSnapshot(resource())), true);
  const edited = resource();
  edited.title = 'Workshop sign-up (edited in Typeform)';
  assert.equal(typeformUnchanged(base, typeformEditSnapshot(edited)), false);
  const touched = resource();
  touched.updatedAt = '2026-01-02T00:00:05Z';
  assert.equal(typeformUnchanged(base, typeformEditSnapshot(touched)), false);
});

// ── Adapter: the write itself ────────────────────────────────────────────────────────────────

const connection = (userId = 'user-a') => ({
  ok: true, provider: 'typeform', userId, externalAccountId: 'acct-1', externalAccountEmail: 'owner@example.test',
  scopes: ['forms:read', 'forms:write'], accessToken: 'token', accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
});

/** Applies a PUT payload the way Typeform would: what arrives replaces what was there. */
function applyPayload(before, payload) {
  return {
    ...before,
    title: payload.title ?? before.title,
    fields: payload.fields ?? before.fields,
    settings: payload.settings ?? before.settings,
    logic: payload.logic ?? [],
    welcomeScreens: payload.welcome_screens ?? [],
    thankYouScreens: payload.thankyou_screens ?? [],
    updatedAt: '2026-01-03T00:00:00Z',
  };
}

function harness(options = {}) {
  const calls = [];
  const live = options.live ?? resource();
  const client = {
    async getForm() { return structuredClone(live); },
    async updateForm(_token, _id, payload) {
      calls.push(payload);
      const next = applyPayload(live, payload);
      return structuredClone(options.after ? options.after(next) : next);
    },
    async createForm() { throw new Error('not used'); },
    async listForms() { return { items: [], pageCount: 0, totalItems: 0 }; },
    async deleteForm() {},
    async listResponses() { return { items: [], totalPages: 0, totalItems: 0 }; },
    async getUserInfo() { return { id: 'acct-1', email: 'owner@example.test', name: 'Owner', accountType: 'personal', plan: 'basic' }; },
  };
  const provider = createTypeformProvider({
    getConnection: async (userId, id) => (options.connection ? options.connection(userId, id) : connection(userId)),
    client,
  });
  return { provider, calls };
}

test('applyEditPlan writes the whole form once and reports the verified result', async () => {
  const { provider, calls } = harness();
  const base = typeformEditSnapshot(resource());
  const result = await provider.applyEditPlan('user-a', {
    base,
    plan: { formId: 'JiLEvIgv', summary: 'Make dietary needs required', operations: [{ type: 'update_question', questionId: 'diet', changes: { required: true } }] },
    expectedAccountId: 'acct-1',
  });
  assert.equal(calls.length, 1, 'one PUT, never a retry');
  assert.deepEqual(calls[0].settings, resource().settings, 'settings are echoed');
  assert.deepEqual(calls[0].logic, []);
  assert.equal(calls[0].welcomeScreens[0].properties.description, 'Sign up for the workshop.');
  assert.deepEqual(calls[0].thankYouScreens, resource().thankYouScreens, 'screens are echoed');
  assert.equal(calls[0].theme.href.endsWith('/themes/theme-1'), true);
  assert.equal(result.current.items[1].required, true);
  assert.equal(result.externalAccountId, 'acct-1');
});

test('a form that moved under the proposal is refused before any write', async () => {
  const live = resource();
  live.title = 'Edited elsewhere';
  const { provider, calls } = harness({ live });
  await assert.rejects(provider.applyEditPlan('user-a', {
    base: typeformEditSnapshot(resource()),
    plan: { formId: 'JiLEvIgv', summary: 'Rename', operations: [{ type: 'update_title', title: 'New' }] },
    expectedAccountId: 'acct-1',
  }), error => error.info.code === 'edit_stale' && error.info.outcome === 'stale');
  assert.equal(calls.length, 0, 'nothing was written');
});

test('a different connected account is refused before any write', async () => {
  const { provider, calls } = harness();
  await assert.rejects(provider.applyEditPlan('user-a', {
    base: typeformEditSnapshot(resource()),
    plan: { formId: 'JiLEvIgv', summary: 'Rename', operations: [{ type: 'update_title', title: 'New' }] },
    expectedAccountId: 'someone-else',
  }), error => error.info.code === 'form_not_editable');
  assert.equal(calls.length, 0);
});

test('a form that comes back missing a question is blocked, not retried', async () => {
  const { provider, calls } = harness({ after: next => ({ ...next, fields: next.fields.slice(0, 2) }) });
  await assert.rejects(provider.applyEditPlan('user-a', {
    base: typeformEditSnapshot(resource()),
    plan: { formId: 'JiLEvIgv', summary: 'Rename', operations: [{ type: 'update_title', title: 'Workshop sign-up 2027' }] },
    expectedAccountId: 'acct-1',
  }), error => error.info.code === 'provider_error' && error.info.outcome === 'partial' && /does not match the proposal/.test(error.info.message));
  assert.equal(calls.length, 1, 'the write happened once; the recovery is a read');
});

test('a connection that cannot be used is an unapplied failure, never an unknown outcome', async () => {
  const { provider } = harness({ connection: (userId, id) => ({ ok: false, provider: id, reason: 'not_connected' }) });
  await assert.rejects(provider.applyEditPlan('user-a', {
    base: typeformEditSnapshot(resource()),
    plan: { formId: 'JiLEvIgv', summary: 'Rename', operations: [{ type: 'update_title', title: 'New' }] },
    expectedAccountId: 'acct-1',
  }), error => error.info.code === 'provider_not_connected' && error.info.outcome === 'not_applied');
});

// ── Engine: a Typeform record goes through the same proposal → confirm path ─────────────────

test('a Typeform record can be inspected, proposed and applied through the edit engine', async () => {
  const { createFormEditEngine } = await import('../server/forms/edit-engine.ts');
  const { createMemoryFormEditDraftStore } = await import('../server/forms/edit-memory-store.ts');
  const { createPendingProvider } = await import('../server/forms/provider.ts');

  const { provider, calls } = harness();
  const record = {
    id: 'record-1', userId: 'user-a', provider: 'typeform', externalAccountId: 'acct-1', providerFormId: 'JiLEvIgv',
    title: 'Workshop sign-up', status: 'created', editUrl: null, responderUrl: null, failureStage: null,
    requestId: 'req_create_1', specification: null, specificationVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  };
  let metadata = null;
  const forms = {
    async getForUser(userId, id) { return userId === 'user-a' && id === record.id ? { ...record } : null; },
    async updateMetadata(input) { metadata = input; return true; },
    async getByProviderFormId() { return null; },
  };
  const seen = [];
  const interpreter = {
    async interpret(input) {
      seen.push(input);
      return { status: 'ready', summary: 'Made dietary needs required', question: null, explanation: null,
        operations: [{ type: 'update_question', questionId: 'diet', changes: { required: true } }] };
    },
  };
  const engine = createFormEditEngine({
    providers: {
      google: createPendingProvider('google', 'not used here'),
      typeform: provider,
      microsoft: createPendingProvider('microsoft', 'not used here'),
    },
    forms,
    drafts: createMemoryFormEditDraftStore(),
    interpreter,
    now: () => new Date('2026-01-03T00:00:00.000Z'),
    newId: () => '11111111-1111-4111-8111-111111111111',
    log: () => {},
  });

  const target = { kind: 'record', formRecordId: 'record-1' };
  const inspected = await engine.inspect('user-a', target);
  assert.equal(inspected.loaded.current.providerFormId, 'JiLEvIgv');
  assert.equal(inspected.loaded.current.items.length, 3);
  assert.equal(inspected.provider, 'typeform');
  assert.equal(seen.length, 0, 'inspecting a form never calls the model');

  const proposed = await engine.interpret('user-a', { target, request: 'make dietary needs required' });
  assert.equal(proposed.status, 'ready');
  assert.equal(proposed.draft.provider, 'typeform', 'the draft remembers which provider it belongs to');
  assert.equal(seen[0].provider, 'typeform', 'the model is briefed with Typeform rules, not Google ones');

  const before = calls.length;
  const result = await engine.confirm('user-a', { draftId: proposed.draft.id, version: 1, confirm: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, before + 1, 'exactly one write');
  assert.equal(calls.at(-1).fields[1].validations.required, true);
  assert.equal(metadata?.title, 'Workshop sign-up', 'the Intake record is refreshed from the verified form');
});
