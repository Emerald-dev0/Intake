import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/app/developers', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { DevelopersWorkspacePage, DeveloperFormPage } = await import('../src/app/DevelopersConsole.tsx');

after(() => dom.window.close());

const PROJECT = {
  id: 'dev_proj_1', name: 'Checkout app', slug: 'checkout-app', description: null,
  status: 'active', createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
};
const FORM = {
  id: 'dev_form_1', projectId: 'dev_proj_1', name: 'Waitlist', slug: 'waitlist',
  status: 'published', createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
};
const DEFINITION = {
  fields: [
    { id: 'email', type: 'email', label: 'Email', description: null, required: true, options: [], placeholder: null },
    { id: 'size', type: 'dropdown', label: 'Team size', description: null, required: false, options: ['1-10', '11-50'], placeholder: null },
  ],
  theme: { mode: 'system', primary: '#ff5a1f', background: '#ffffff', text: '#1a1b18', border: '#d8d4cc', fontFamily: null, radius: 8, transparentBackground: false },
  submitLabel: null,
  successMessage: null,
};

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fetch that answers the developer API, and records what was called. */
function fakeFetch({ projects = [PROJECT], forms = [FORM], detail, calls = [] } = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET', body: init.body ?? null });
    if (url.endsWith('/api/dev/projects') && (init.method ?? 'GET') === 'GET') return respond({ projects });
    if (url.endsWith('/api/dev/projects') && init.method === 'POST') return respond({ project: { ...PROJECT, name: 'Created' } }, 201);
    if (url.includes('/api/dev/projects/') && url.endsWith('/forms') && init.method === 'POST') return respond({ form: FORM, project: PROJECT, publishedVersion: null, draftVersion: null, versions: [] }, 201);
    if (url.includes('/api/dev/projects/')) return respond({ project: PROJECT, forms });
    if (url.endsWith('/api/dev/forms/dev_form_1/publish')) return respond(detail ?? { form: FORM, project: PROJECT, publishedVersion: null, draftVersion: null, versions: [] });
    if (url.endsWith('/api/dev/forms/dev_form_1/state')) return respond(detail ?? { form: FORM, project: PROJECT, publishedVersion: null, draftVersion: null, versions: [] });
    if (url.endsWith('/api/dev/forms/dev_form_1')) {
      return respond(detail ?? {
        form: FORM,
        project: PROJECT,
        publishedVersion: { id: 'dev_ver_1', formId: FORM.id, version: 1, definition: DEFINITION, state: 'published', createdAt: '2026-10-29T00:00:00.000Z', publishedAt: '2026-10-29T00:00:00.000Z' },
        draftVersion: { id: 'dev_ver_2', formId: FORM.id, version: 2, definition: DEFINITION, state: 'draft', createdAt: '2026-10-29T00:00:00.000Z', publishedAt: null },
        versions: [
          { id: 'dev_ver_2', formId: FORM.id, version: 2, definition: DEFINITION, state: 'draft', createdAt: '2026-10-29T00:00:00.000Z', publishedAt: null },
          { id: 'dev_ver_1', formId: FORM.id, version: 1, definition: DEFINITION, state: 'published', createdAt: '2026-10-29T00:00:00.000Z', publishedAt: '2026-10-29T00:00:00.000Z' },
        ],
      });
    }
    return respond({ error: 'not_found' }, 404);
  };
}

async function mount(element, { fetchImpl, path = '/app/developers' } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl ?? fakeFetch();
  const router = createMemoryRouter(
    [
      { path: '/app/developers', element },
      { path: '/app/developers/forms/:formId', element },
    ],
    { initialEntries: [path] },
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(RouterProvider, { router })));
  return {
    container,
    text: () => container.textContent ?? '',
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('the workspace lists the projects and the forms inside them', async t => {
  const view = await mount(React.createElement(DevelopersWorkspacePage));
  t.after(view.restore);

  assert.match(view.text(), /Checkout app/);
  assert.match(view.text(), /Waitlist/);
  assert.match(view.text(), /Published/);
});

test('an empty workspace says so instead of showing a blank page', async t => {
  const view = await mount(React.createElement(DevelopersWorkspacePage), { fetchImpl: fakeFetch({ projects: [], forms: [] }) });
  t.after(view.restore);

  assert.match(view.text(), /No projects yet/);
});

test('a server failure is written in a sentence, with a way to try again', async t => {
  const failing = async () => respond({ error: 'storage_unavailable', message: 'Intake is temporarily unavailable. Please try again later.' }, 503);
  const view = await mount(React.createElement(DevelopersWorkspacePage), { fetchImpl: failing });
  t.after(view.restore);

  assert.match(view.text(), /temporarily unavailable/);
  assert.ok([...view.container.querySelectorAll('button')].some(button => button.textContent === 'Try again'));
});

test('a form shows its questions, its versions and the moves it can make', async t => {
  const view = await mount(React.createElement(DeveloperFormPage), { path: '/app/developers/forms/dev_form_1' });
  t.after(view.restore);

  assert.match(view.text(), /Email/);
  assert.match(view.text(), /Team size/);
  assert.match(view.text(), /Version 1/);
  assert.match(view.text(), /Version 2/);

  // A published form may be paused, closed or archived — and nothing else.
  const labels = [...view.container.querySelectorAll('.dev-actions button')].map(button => button.textContent);
  assert.deepEqual(labels.sort(), ['Archive', 'Close', 'Pause']);
});

test('a published form shows its permanent address and a snippet to copy', async t => {
  const view = await mount(React.createElement(DeveloperFormPage), { path: '/app/developers/forms/dev_form_1' });
  t.after(view.restore);

  const text = view.text();
  assert.match(text, /\/forms\/checkout-app\/waitlist/);
  assert.match(text, /<iframe src="https:\/\/intake.test\/embed\/forms\/checkout-app\/waitlist"/);
  // The copy button must not claim success before it has succeeded.
  assert.ok([...view.container.querySelectorAll('button')].some(button => button.textContent === 'Copy'));
  assert.ok(![...view.container.querySelectorAll('button')].some(button => button.textContent === 'Copied'));
});

test('the builder lists the questions and opens the one you pick', async t => {
  const view = await mount(React.createElement(DeveloperFormPage), { path: '/app/developers/forms/dev_form_1' });
  t.after(view.restore);

  const rows = [...view.container.querySelectorAll('.dev-list--builder .dev-list__row')];
  assert.equal(rows.length, 2, 'both questions are listed');
  assert.match(rows[0].textContent, /Email/);

  await act(async () => { rows[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.match(view.text(), /Edit: Team size/);
  assert.ok(view.container.querySelector('.dev-editor .dev-textarea'), 'the options of a choice field can be edited');
});

test('a draft cannot be paused, and says why', async t => {
  const draft = { ...FORM, status: 'draft' };
  const view = await mount(React.createElement(DeveloperFormPage), {
    path: '/app/developers/forms/dev_form_1',
    fetchImpl: fakeFetch({
      detail: {
        form: draft, project: PROJECT, publishedVersion: null,
        draftVersion: { id: 'dev_ver_1', formId: draft.id, version: 1, definition: DEFINITION, state: 'draft', createdAt: '2026-10-29T00:00:00.000Z', publishedAt: null },
        versions: [{ id: 'dev_ver_1', formId: draft.id, version: 1, definition: DEFINITION, state: 'draft', createdAt: '2026-10-29T00:00:00.000Z', publishedAt: null }],
      },
    }),
  });
  t.after(view.restore);

  assert.equal(view.container.querySelectorAll('.dev-actions button').length, 0);
  assert.match(view.text(), /not public yet/);
});

test('creating a project goes through the server and refreshes the list', async t => {
  const calls = [];
  const view = await mount(React.createElement(DevelopersWorkspacePage), { fetchImpl: fakeFetch({ calls }) });
  t.after(view.restore);

  const input = view.container.querySelector('.dev-field input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'New project');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Create project');
  await act(async () => { submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  const created = calls.find(call => call.method === 'POST' && call.url.endsWith('/api/dev/projects'));
  assert.ok(created, 'the project is created through the API');
  assert.equal(JSON.parse(created.body).name, 'New project');
});
