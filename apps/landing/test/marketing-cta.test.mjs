import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../src/app/routes.tsx';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('public marketing and pricing CTAs route signed-in visitors to the app', async () => {
  const original = globalThis.fetch;
  const cases = [
    ['/', 200, '.mk-header__actions .mk-button--nav', '/app'],
    ['/', 401, '.mk-header__actions .mk-button--nav', '/auth/sign-up'],
    ['/pricing', 200, '.pricing-plan-card a.pricing-plan-action', '/app'],
    ['/pricing', 401, '.pricing-plan-card a.pricing-plan-action', '/auth/sign-up'],
  ];
  try {
    for (const [path, status, selector, expectedHref] of cases) {
      globalThis.fetch = async target => {
        assert.equal(target, '/api/me');
        return status === 200
          ? new Response(JSON.stringify({ user: { id: 'public-user' } }), { status })
          : new Response(JSON.stringify({ error: 'not_authenticated' }), { status });
      };
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      const root = createRoot(document.getElementById('root'));
      try {
        await act(async () => {
          root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router })));
        });
        for (let i = 0; i < 40 && document.querySelector(selector)?.getAttribute('href') !== expectedHref; i++) {
          await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        }
        assert.equal(document.querySelector(selector)?.getAttribute('href'), expectedHref, `${path} (${status})`);
        if (path === '/pricing') {
          assert.equal(document.querySelectorAll('main').length, 1);
          assert.equal(document.querySelector('.skip-link')?.getAttribute('href'), '#pricing-main');
          assert.ok(document.getElementById('pricing-main'));
        }
        if (path === '/') {
          assert.equal(document.querySelectorAll('#main-content h1').length, 1);
          for (const element of document.querySelectorAll('[aria-labelledby]')) {
            for (const id of element.getAttribute('aria-labelledby').split(/\s+/)) {
              assert.ok(document.getElementById(id), `aria-labelledby target #${id} exists`);
            }
          }
          const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
          assert.equal(new Set(ids).size, ids.length, 'marketing document IDs are unique');
          for (const control of document.querySelectorAll('a[href], button, summary')) {
            const namedBy = control.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
            const name = control.getAttribute('aria-label') || namedBy || control.textContent.trim();
            assert.ok(name, `${control.tagName} has an accessible name`);
          }
          const [createTab, editTab] = document.querySelectorAll('.mk-preview-switch button');
          assert.ok(createTab && editTab);
          assert.equal(createTab.getAttribute('aria-pressed'), 'true');
          assert.equal(editTab.getAttribute('aria-pressed'), 'false');
          await act(async () => editTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
          assert.equal(createTab.getAttribute('aria-pressed'), 'false');
          assert.equal(editTab.getAttribute('aria-pressed'), 'true');
          assert.ok(document.body.textContent.includes('DRAFT · NOT APPLIED'));
          assert.ok(document.body.textContent.includes('Would you like a follow-up call?'));
        }
      } finally {
        await act(async () => root.unmount());
        router.dispose();
      }
    }
  } finally {
    globalThis.fetch = original;
  }
});
