import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/forms/checkout-app/waitlist', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { HostedFormPage } = await import('../src/marketing/HostedFormPage.tsx');

after(() => dom.window.close());

const DEFINITION = {
  fields: [
    { id: 'email', type: 'email', label: 'Email', description: 'We only use it to reply.', required: true, options: [], placeholder: null },
    { id: 'name', type: 'short_text', label: 'Name', description: null, required: false, options: [], placeholder: null },
    { id: 'size', type: 'single_choice', label: 'Team size', description: null, required: false, options: ['1-10', '11-50'], placeholder: null },
    { id: 'tags', type: 'multiple_choice', label: 'Interests', description: null, required: false, options: ['docs', 'api'], placeholder: null },
    { id: 'notes', type: 'long_text', label: 'Anything else', description: null, required: false, options: [], placeholder: null },
  ],
  theme: { mode: 'dark', primary: '#ff5a1f', background: '#101210', text: '#f2efe6', border: '#333333', fontFamily: 'Inter', radius: 14, transparentBackground: true },
  submitLabel: 'Join the list',
  successMessage: 'You are on the list. We will be in touch.',
};

function payload(definition = DEFINITION) {
  return { form: { name: 'Waitlist', slug: 'waitlist', projectSlug: 'checkout-app', version: 1 }, definition };
}

async function mount(props, { fetchImpl } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = fetchImpl ?? (async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET', headers: init.headers ?? {} });
    return new Response(JSON.stringify(payload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(HostedFormPage, props)));
  return {
    container,
    calls,
    text: () => container.textContent ?? '',
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('the form renders every field type with a label', async t => {
  const view = await mount({ projectSlug: 'checkout-app', formSlug: 'waitlist' });
  t.after(view.restore);

  assert.match(view.text(), /Waitlist/);
  assert.match(view.text(), /Email/);
  assert.ok(view.container.querySelector('input[type="email"]'));
  assert.ok(view.container.querySelector('input[type="text"]'));
  assert.ok(view.container.querySelector('textarea'));
  assert.ok(view.container.querySelectorAll('input[type="radio"]').length >= 2);
  assert.ok(view.container.querySelectorAll('input[type="checkbox"]').length >= 2);
  assert.equal(view.container.querySelectorAll('[id^="hf-field-"]').length >= 3, true);
});

test('the theme is applied as variables, because an iframe cannot inherit CSS', async t => {
  const view = await mount({ projectSlug: 'checkout-app', formSlug: 'waitlist' });
  t.after(view.restore);

  const root = view.container.querySelector('.hf');
  assert.equal(root.style.getPropertyValue('--hf-primary'), '#ff5a1f');
  assert.equal(root.style.getPropertyValue('--hf-radius'), '14px');
  assert.equal(root.style.getPropertyValue('--hf-font'), 'Inter');
});

test('a required field that is empty is refused before anything is sent', async t => {
  const view = await mount({ projectSlug: 'checkout-app', formSlug: 'waitlist' });
  t.after(view.restore);

  const form = view.container.querySelector('form');
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });

  assert.match(view.text(), /needs an answer/);
  assert.equal(view.calls.filter(call => call.method === 'POST').length, 0, 'nothing was sent');
});

test('an email that is not one is refused', async t => {
  const view = await mount({ projectSlug: 'checkout-app', formSlug: 'waitlist' });
  t.after(view.restore);

  const email = view.container.querySelector('input[type="email"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(email, 'not-an-email');
    email.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const form = view.container.querySelector('form');
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });

  assert.match(view.text(), /does not look like an email/);
  assert.equal(view.calls.filter(call => call.method === 'POST').length, 0);
});

test('a good answer is sent once, with an idempotency key, and the thank-you is shown', async t => {
  const view = await mount({ projectSlug: 'checkout-app', formSlug: 'waitlist' });
  t.after(view.restore);

  const email = view.container.querySelector('input[type="email"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(email, 'someone@example.com');
    email.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const form = view.container.querySelector('form');
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });

  const post = view.calls.find(call => call.method === 'POST');
  assert.ok(post, 'the answer was sent');
  assert.ok(post.headers['Idempotency-Key'], 'the request carries a key, so a retry is not a second answer');
  assert.match(view.text(), /You are on the list/);
});

test('a form that is not there says so, and does not show an empty box', async t => {
  const view = await mount(
    { projectSlug: 'checkout-app', formSlug: 'gone' },
    { fetchImpl: async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }) },
  );
  t.after(view.restore);

  assert.match(view.text(), /no form at this address/);
  assert.equal(view.container.querySelector('form'), null);
});

test('a form that cannot be loaded says so', async t => {
  const view = await mount(
    { projectSlug: 'checkout-app', formSlug: 'waitlist' },
    { fetchImpl: async () => { throw new Error('offline'); } },
  );
  t.after(view.restore);

  assert.match(view.text(), /having a moment/);
});

test('the embed variant carries no site chrome', async t => {
  const view = await mount({ projectSlug: 'checkout-app', formSlug: 'waitlist', variant: 'embed' });
  t.after(view.restore);

  assert.equal(view.container.querySelector('.hf__footnote'), null);
  assert.equal(view.container.querySelector('.hf__byline'), null);
  assert.ok(view.container.querySelector('.hf--embed'));
});
