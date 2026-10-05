import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, matchRoutes } from 'react-router-dom';
import { routes } from '../src/app/routes.tsx';
import { api, ApiError } from '../src/lib/api.ts';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });

function fixtureProvider(id) {
  return {
    id,
    name: id === 'google' ? 'Google Forms' : 'Microsoft Forms',
    accountName: id === 'google' ? 'Google account' : 'Microsoft account',
    description: 'Fixture provider',
    configured: true,
    setupEnv: [`${id.toUpperCase()}_OAUTH_CLIENT_ID`],
    status: 'not_connected',
    accountEmail: null,
    accountLabel: null,
    scopes: [],
    scopeLabels: [],
    connectedAt: null,
    canRefresh: false,
    revocation: 'supported',
    formsApi: id === 'google' ? 'supported' : 'unsupported',
    formsNote: 'Fixture note',
    permissionLinks: [],
  };
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('all public and protected paths have explicit ownership', () => {
  for (const path of ['/', '/auth/sign-in', '/auth/sign-up', '/app', '/app/connections', '/app/forms', '/app/library', '/app/account']) {
    const matches = matchRoutes(routes, path);
    assert.ok(matches);
    assert.notEqual(matches.at(-1).route.path, '*');
    assert.equal(matches.some(m => m.route.path === '/app'), path.startsWith('/app'));
  }
  assert.equal(matchRoutes(routes, '/application').at(-1).route.path, '*');
  assert.equal(matchRoutes(routes, '/app/forms').at(-1).route.path, 'forms', 'the forms page has its own protected route');
  assert.equal(matchRoutes(routes, '/app/forms')[0].route.path, '/app');
  assert.equal(matchRoutes(routes, '/admin')[0].route.path, '/admin');
  assert.equal(matchRoutes(routes, '/admin/users/owner-id')[0].route.path, '/admin');
});

test('API helper keeps requests same-origin, uncached and surfaces authentication failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (path, init) => {
      assert.equal(path, '/api/providers');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.cache, 'no-store');
      return new Response('{}', { status: 401 });
    };
    await assert.rejects(api('/api/providers'), e => e instanceof ApiError && e.status === 401);
  } finally { globalThis.fetch = original; }
});

test('public auth pages and protected pages render with shared authentication enforcement', async () => {
  const original = globalThis.fetch;
  try {
    for (const [path, status, expected] of [
      ['/', 200, 'Tell Intake what you need.'],
      ['/auth/sign-in', 503, 'Welcome back'],
      ['/auth/sign-up', 503, 'Create your account'],
      ['/app', 200, 'What do you need'],
      ['/app/connections', 200, 'Your forms stay'],
      ['/app/forms', 200, 'What should your form ask?'],
      ['/app/library', 200, 'Your Forms'],
      ['/app/account', 200, 'Your account.'],
      ['/app', 401, 'Welcome back'],
      ['/app/connections', 401, 'Welcome back'],
      ['/app/forms', 401, 'Welcome back'],
      ['/app/library', 401, 'Welcome back'],
      ['/app/account', 401, 'Welcome back'],
      ['/app', 503, 'We couldn’t verify your session'],
    ]) {
      let sessionCalls = 0;
      let providerCalls = 0;
      let creditCalls = 0;
      globalThis.fetch = async path => {
        if (path === '/api/providers') {
          providerCalls++;
          return new Response(JSON.stringify({ providers: [fixtureProvider('google'), fixtureProvider('microsoft')] }), { status: 200 });
        }
        if (path === '/api/forms') return new Response(JSON.stringify({ forms: [] }), { status: 200 });
        // The shared workspace shell also reads the public credit balance.
        if (path === '/api/credits') {
          creditCalls++;
          return new Response(JSON.stringify({ credits: { plan: 'free', dailyRemaining: 20, monthlyRemaining: 0,
            nextDailyReset: '2026-10-04T00:00:00.000Z', nextMonthlyReset: '2026-11-01T00:00:00.000Z' } }), { status: 200 });
        }
        // Sign-in configuration is a public, unauthenticated probe used to decide whether to show Google.
        if (path === '/api/sign-in/config') return new Response(JSON.stringify({ providers: { google: false } }), { status: 200 });
        assert.equal(path, '/api/me');
        sessionCalls++;
        return new Response(JSON.stringify({ user: { id: 'test', name: 'Test User', email: 'test@example.com' } }), { status });
      };
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      const root = createRoot(document.getElementById('root'));
      try {
        await act(async () => { root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))); });
        // Lazy page modules resolve asynchronously.
        for (let i = 0; i < 30 && !document.body.textContent.includes(expected); i++) {
          await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        }
        assert.ok(document.body.textContent.includes(expected), `${path} (${status}): ${document.body.textContent}`);
        if (path.startsWith('/auth')) assert.equal(sessionCalls, 0);
        if (path.startsWith('/app') && status === 200) {
          assert.equal(sessionCalls, 1, `${path}: session revalidated once`);
          assert.equal(providerCalls, 1, `${path}: providers loaded once by the shared workspace shell`);
          assert.equal(creditCalls, 1, `${path}: the credit balance is read once by the shared workspace shell`);
        }
        if (status === 401 && path.startsWith('/app')) assert.equal(router.state.location.pathname, '/auth/sign-in');
      } finally { await act(async () => root.unmount()); router.dispose(); }
    }
  } finally { globalThis.fetch = original; }
});
