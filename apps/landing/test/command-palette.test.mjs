import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The palette is the answer to "how do I get to that form?" — so the tests are about the three
 * things that make it usable without a mouse: the shortcut, the listbox keys, and focus returning
 * where it came from. The network is stubbed; the timing (debounce) is real.
 */

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/app', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { CommandPalette, useCommandPalette } = await import('../src/app/components/CommandPalette.tsx');
after(() => dom.window.close());

const FORM = (id, title) => ({
  id, provider: 'google', providerFormId: `pf_${id}`, title, status: 'created', failureStage: null,
  editUrl: `https://docs.google.com/forms/${id}/edit`, responderUrl: `https://docs.google.com/forms/${id}`,
  createdAt: '2026-10-01T00:00:00.000Z', description: null, source: 'created',
  lastSyncedAt: null, archivedAt: null, updatedAt: '2026-10-01T00:00:00.000Z',
});

const DESTINATIONS = [
  { label: 'New chat', hint: 'Start a form from a sentence', to: '/app/forms', shortcut: '＋' },
  { label: 'Library', hint: '/app/library', to: '/app/library' },
  { label: 'Billing', hint: '/app/billing', to: '/app/billing' },
];

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

async function mount(t, { handler } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    if (handler) return handler(path);
    if (String(path).includes('query=')) return json({ forms: [FORM('ada-form', 'Ada conference sign-up')] });
    return json({ forms: [FORM('one', 'Workshop RSVP'), FORM('two', 'Clinic intake')] });
  };

  function Page() {
    const palette = useCommandPalette();
    return React.createElement('div', null,
      React.createElement('button', { id: 'opener', onClick: event => palette.openWith(event.currentTarget) }, 'Search'),
      React.createElement('button', { id: 'other' }, 'Elsewhere'),
      React.createElement(CommandPalette, {
        open: palette.open,
        onClose: () => palette.setOpen(false),
        destinations: DESTINATIONS,
        returnFocusTo: palette.opener,
      }),
    );
  }

  // Destinations must exist as routes, so "Enter navigates" is a real navigation and not a 404 the
  // router logs while the test still passes.
  const blank = () => React.createElement('div', null, 'destination');
  const router = createMemoryRouter([
    { path: '/app', element: React.createElement(Page) },
    { path: '/app/billing', element: React.createElement(blank) },
    { path: '/app/library', element: React.createElement(blank) },
    { path: '/app/forms', element: React.createElement(blank) },
  ], { initialEntries: ['/app'] });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = original;
    document.getElementById('root').innerHTML = '';
  });
  await act(async () => root.render(React.createElement(RouterProvider, { router })));
  return { calls, router };
}

function press(key, { meta = false, shift = false } = {}) {
  return act(async () => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, metaKey: meta, shiftKey: shift, bubbles: true }));
  });
}

function dialogKey(key, { shift = false } = {}) {
  const dialog = document.querySelector('.palette__dialog');
  return act(async () => {
    dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }));
  });
}

const options = () => [...document.querySelectorAll('[role="option"]')];
const activeLabel = () => document.querySelector('[role="option"][aria-selected="true"] .palette__label')?.textContent;

test('⌘K opens the palette, and it loads recent forms plus every destination', async t => {
  const { calls } = await mount(t);
  assert.equal(document.querySelector('.palette'), null, 'closed until asked for');

  await press('k', { meta: true });
  assert.ok(document.querySelector('.palette__dialog'), '⌘K opens it');
  await settle();
  assert.equal(document.activeElement?.getAttribute('role'), 'combobox', 'the field is focused, not the page');

  // Recent forms are fetched on open with no query at all.
  assert.equal(calls.length, 1, 'one request for recent forms');
  assert.equal(calls[0].path, '/api/forms/library');

  const labels = options().map(option => option.querySelector('.palette__label').textContent);
  assert.deepEqual(labels.slice(0, 2), ['Workshop RSVP', 'Clinic intake']);
  assert.ok(labels.includes('New chat') && labels.includes('Billing'), 'destinations are in the same list');

  await press('k', { meta: true });
  assert.equal(document.querySelector('.palette'), null, 'the same shortcut closes it');
});

test('arrow keys move, Enter opens, and Escape returns focus to the opener', async t => {
  const { router } = await mount(t);
  document.getElementById('opener').focus();
  await act(async () => document.getElementById('opener').click());

  // First item is the first form, so two downs lands on 'Billing' in the destination group.
  await dialogKey('ArrowDown');
  assert.match(activeLabel(), /Clinic intake/);
  await dialogKey('ArrowDown');
  assert.match(activeLabel(), /New chat/);

  await dialogKey('ArrowUp');
  assert.match(activeLabel(), /Clinic intake/);

  await dialogKey('Escape');
  assert.equal(document.querySelector('.palette'), null);
  await settle();
  assert.equal(document.activeElement?.id, 'opener', 'focus goes back to what opened it');
  assert.equal(router.state.location.pathname, '/app', 'Escape navigates nowhere');
});

test('Enter navigates to the chosen destination', async t => {
  const { router } = await mount(t);
  await act(async () => document.getElementById('opener').click());

  // Walk to 'Billing' (two forms, then New chat, Library, Billing).
  for (let index = 0; index < 4; index += 1) await dialogKey('ArrowDown');
  assert.match(activeLabel(), /Billing/);
  await dialogKey('Enter');
  await act(async () => { await Promise.resolve(); });
  assert.equal(router.state.location.pathname, '/app/billing');
});

test('typing searches the server, not a list the browser was never given', async t => {
  const { calls } = await mount(t);
  await press('k', { meta: true });
  const input = document.querySelector('.palette__field input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'ada');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });

  const search = calls.filter(call => String(call.path).includes('query='));
  assert.equal(search.length, 1, 'one debounced request');
  assert.match(search[0].path, /\/api\/forms\/library\?query=ada/);
  assert.equal(search[0].init.credentials, 'same-origin');
  assert.equal(search[0].init.cache, 'no-store');

  const labels = options().map(option => option.querySelector('.palette__label').textContent);
  assert.deepEqual(labels, ['Ada conference sign-up'], 'destinations that do not match the query drop out');
});

test('a failed search says so, and still lets you jump to a page', async t => {
  await mount(t, { handler: () => new Response('{}', { status: 503 }) });
  await press('k', { meta: true });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

  assert.match(document.body.textContent, /could not be searched just now/i);
  assert.doesNotMatch(document.body.textContent, /No forms/i, 'a failure is never shown as an empty result');
  const labels = options().map(option => option.querySelector('.palette__label').textContent);
  assert.deepEqual(labels, ['New chat', 'Library', 'Billing'], 'navigation still works');
});

test('the shortcut is ignored while typing in a normal field', async t => {
  await mount(t);
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  });
  assert.equal(document.querySelector('.palette'), null, 'Ctrl-K in a text field stays a text-field shortcut');
  input.remove();
});
