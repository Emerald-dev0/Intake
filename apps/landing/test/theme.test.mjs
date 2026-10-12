import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, isTheme, persistTheme, resolveTheme, storedTheme } from '../src/lib/theme.ts';
import { ThemeToggle } from '../src/components/ThemeToggle.tsx';

const dom = new JSDOM('<div id="root"></div><meta name="theme-color" content="#0c0c0b" />', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resetDom() {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
}

test('theme resolution prefers a saved choice, then the OS, then dark', () => {
  resetDom();
  window.localStorage.setItem('intake-theme', 'light');
  assert.equal(resolveTheme(), 'light');
  assert.equal(storedTheme(), 'light');

  window.localStorage.clear();
  window.matchMedia = () => ({ matches: true });
  assert.equal(resolveTheme(), 'light');

  window.matchMedia = () => ({ matches: false });
  assert.equal(resolveTheme(), 'dark');

  window.localStorage.setItem('intake-theme', 'sepia');
  assert.equal(storedTheme(), null, 'unknown stored values never become a theme');
  assert.equal(isTheme('sepia'), false);
  assert.equal(isTheme('dark'), true);
});

test('applying a theme writes the attribute and the theme-color meta', () => {
  resetDom();
  applyTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.querySelector('meta[name="theme-color"]').getAttribute('content'), '#f5f0e6');
  applyTheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.querySelector('meta[name="theme-color"]').getAttribute('content'), '#0c0c0b');
});

test('the toggle flips the theme and persists the choice', async (t) => {
  resetDom();
  document.documentElement.dataset.theme = 'dark';
  const root = createRoot(document.getElementById('root'));
  t.after(() => act(async () => { root.unmount(); }));
  await act(async () => { root.render(React.createElement(ThemeToggle, { className: 'mk-theme-toggle' })); });
  const button = document.querySelector('.mk-theme-toggle');
  assert.ok(button, 'the toggle renders');
  assert.match(button.getAttribute('aria-label'), /Switch to light mode/);
  await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(window.localStorage.getItem('intake-theme'), 'light');
  assert.match(button.getAttribute('aria-label'), /Switch to dark mode/);
});

test('persisting never throws when storage is unavailable', () => {
  const original = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error('denied'); };
  try {
    persistTheme('dark');
  } finally {
    window.localStorage.setItem = original;
  }
});
