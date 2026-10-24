import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/waitlist', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act, Suspense } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { routes } = await import('../src/app/routes.tsx');
after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function page(t, handler = () => json({ status: 'joined' }), path = '/waitlist') {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/analytics/event') return json({ ok: true });
    assert.equal(url, '/api/waitlist', 'the wait-list does not need an account or a server import');
    calls.push({ url, init });
    return handler(url, init);
  };
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); router.dispose(); globalThis.fetch = original; });
  await act(async () => root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))));
  for (let i = 0; i < 50 && !document.querySelector('#waitlist-email'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(document.querySelector('#waitlist-email'));
  return {
    calls, router,
    $: selector => document.querySelector(selector),
    async type(value, selector = '#waitlist-email') {
      const input = document.querySelector(selector);
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async submit() { await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); },
  };
}

test('the wait-list has a single named primary action, meaningful landmarks, and no fake popularity', async t => {
  const view = await page(t);
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.equal(document.querySelectorAll('main').length, 1);
  assert.match(document.querySelector('h1').textContent, /Less busywork.More possibility./);
  assert.equal(document.querySelector('.skip-link').getAttribute('href'), '#waitlist-main');
  assert.equal(document.querySelector('label[for="waitlist-email"]').textContent, 'YOUR EMAIL. YOUR INVITATION.');
  assert.match(document.querySelector('button[type="submit"]').textContent, /Join the wait-list/);
  assert.equal(view.$('#waitlist-email').getAttribute('autocomplete'), 'email');
  assert.equal(view.$('#waitlist-website').tabIndex, -1);
  assert.equal(view.$('#waitlist-website').closest('[aria-hidden]').getAttribute('aria-hidden'), 'true');
  assert.match(document.body.textContent, /daniel@intake.calder.click/);
  assert.doesNotMatch(document.body.textContent, /\d+ people|spots left|your position|welcome email has been sent/i);
  for (const element of document.querySelectorAll('[aria-labelledby], [aria-describedby]')) {
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) assert.ok(document.getElementById(id), id);
    }
  }
});

test('validation is accessible and makes no request for an invalid email', async t => {
  const view = await page(t);
  await view.type('not-an-email');
  await view.submit();
  assert.equal(view.calls.length, 0);
  assert.equal(view.$('#waitlist-email').getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement.id, 'waitlist-email');
  assert.match(view.$('[role="alert"]').textContent, /valid email/);
});

test('signup posts same-origin, shows real confirmation, and never claims delivery or stores email in the URL', async t => {
  const view = await page(t);
  await view.type(' Ada+Early@Example.com ');
  await view.submit();
  assert.equal(view.calls.length, 1);
  const { url, init } = view.calls[0];
  assert.equal(url, '/api/waitlist');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(JSON.parse(init.body), { email: 'ada+early@example.com', website: '' });
  assert.equal(view.$('#waitlist-email'), null);
  assert.match(view.$('[role="status"]').textContent, /You’re on the list/);
  assert.match(view.$('[role="status"]').textContent, /ada\+early@example.com/);
  assert.doesNotMatch(view.$('[role="status"]').textContent, /email (?:has been |was )sent|delivered/i);
  assert.equal(document.activeElement.textContent, 'You’re on the list.');
  assert.equal(view.router.state.location.search, '');
  await act(async () => view.$('.waitlist-success button').click());
  assert.ok(view.$('#waitlist-email'));
  assert.equal(view.$('#waitlist-email').value, '');
});

test('a query parameter cannot forge a successful join', async t => {
  const view = await page(t, undefined, '/waitlist?joined=1&already=1&email=someone@example.com');
  assert.ok(view.$('form'));
  assert.equal(view.$('.waitlist-success'), null);
  assert.equal(view.calls.length, 0);
  assert.equal(view.$('#waitlist-email').value, '');
});

test('sign-up is a real account form, not a detour through the wait-list', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url === '/api/analytics/event') return json({ ok: true });
    assert.match(String(url), /^\/api\/(email\/config|sign-in\/config|auth\/)/, 'account creation does not post to the wait-list');
    return json({ verificationRequired: false, providers: {} });
  };
  const router = createMemoryRouter(routes, { initialEntries: ['/auth/sign-up?plan=pro'] });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); router.dispose(); globalThis.fetch = original; });
  await act(async () => root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))));
  for (let i = 0; i < 50 && !document.querySelector('input[type="password"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });

  assert.equal(router.state.location.pathname, '/auth/sign-up', 'the sign-up URL renders its own page');
  assert.match(document.querySelector('.auth-card h2')?.textContent ?? '', /Create your account/);
  assert.ok(document.querySelector('input[type="password"]'), 'a password field means a real account form');
  // The sign-in page still points at it, so the two halves of the account flow stay connected.
  assert.equal(document.querySelector('.auth-switch a')?.getAttribute('href'), '/auth/sign-in');
});

test('pending submissions are disabled and same-tick double submissions make one request', async t => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const view = await page(t, () => response);
  await view.type('slow@example.com');
  await act(async () => {
    const form = view.$('form');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(view.calls.length, 1);
  assert.equal(view.$('#waitlist-email').disabled, true);
  assert.equal(view.$('button[type="submit"]').disabled, true);
  assert.equal(view.$('form').getAttribute('aria-busy'), 'true');
  await act(async () => { finish(json({ status: 'joined' })); });
  assert.ok(view.$('.waitlist-success'));
});

test('network, rate-limit, database, and malformed success responses are honest and retryable', async t => {
  for (const [response, expected] of [
    [() => json({ error: 'SQL_PASSWORD_PRIVATE' }, 503), /couldn’t save your place/],
    [() => json({ error: 'CALDER_KEY_PRIVATE' }, 429), /too many attempts/],
    [() => { throw Error('private network information'); }, /couldn’t reach Intake/],
    [() => json({ ok: true }), /couldn’t confirm your signup/],
  ]) {
    await t.test(String(expected), async sub => {
      const view = await page(sub, response);
      await view.type('retry@example.com');
      await view.submit();
      assert.match(view.$('[role="alert"]').textContent, expected);
      assert.doesNotMatch(document.body.textContent, /PRIVATE|private network information/);
      assert.equal(view.$('#waitlist-email').value, 'retry@example.com');
      assert.equal(view.$('button[type="submit"]').disabled, false);
      assert.equal(view.$('.waitlist-success'), null);
    });
  }
});

test('both theme modes and keyboard-native FAQs remain available', async t => {
  const view = await page(t);
  const before = document.documentElement.dataset.theme;
  await act(async () => view.$('.waitlist-theme').click());
  assert.notEqual(document.documentElement.dataset.theme, before);
  assert.equal(document.querySelectorAll('.waitlist-faq details').length, 4);
  assert.ok(document.querySelector('.waitlist-faq summary'));
});

test('static wait-list metadata, routing, fallback, sitemap, and mobile/reduced-motion styles ship together', async () => {
  const html = await readFile('dist/waitlist.html', 'utf8');
  assert.match(html, /<title>Join the Intake wait-list/);
  assert.match(html, /rel="canonical" href="https:\/\/intake-six-blue.vercel.app\/waitlist"/);
  assert.match(html, /property="og:url" content="https:\/\/intake-six-blue.vercel.app\/waitlist"/);
  assert.doesNotMatch(html, /%WAITLIST_|%SITE_URL%/);
  assert.match(html, /Enable JavaScript/);
  assert.match(html, /mailto:daniel@intake.calder.click/);
  const routing = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.ok(routing.routes.some(rule => rule.dest === '/waitlist.html'));
  // Sign-up is public and served by the app: no routing rule may bounce it to the wait-list.
  assert.equal(routing.routes.find(rule => rule.src === '/auth/sign-up/?$'), undefined);
  assert.ok(routing.routes.some(rule => rule.src === '/((?:app|admin|auth)(?:/|$).*)'), 'auth pages still use the private document');
  // The wait-list page still exists for old links, but it is no longer advertised to crawlers.
  assert.doesNotMatch(await readFile('dist/sitemap.xml', 'utf8'), /\/waitlist<\/loc>/);
  const css = await readFile('src/styles/waitlist.css', 'utf8');
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /input:focus-visible/);
});
