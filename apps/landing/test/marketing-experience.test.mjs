import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../src/app/routes.tsx';

// `pretendToBeVisual` gives jsdom a requestAnimationFrame, which the reveal and progress effects use.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function waitFor(selector, attempts = 200) {
  for (let attempt = 0; attempt < attempts && !document.querySelector(selector); attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  return document.querySelector(selector);
}

/**
 * Renders a public route and leaves it mounted so tests can interact with real nodes. The returned
 * teardown must run at the end of the test: React removes the tree from its container on unmount,
 * which would make later DOM queries look empty.
 */
async function renderRoute(t, path, selector) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401 });
  const container = document.getElementById('root');
  const root = createRoot(container);
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    await act(async () => { root.unmount(); });
    globalThis.fetch = original;
  };
  t.after(teardown);
  await act(async () => {
    root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router: createMemoryRouter(routes, { initialEntries: [path] }) })));
  });
  assert.ok(await waitFor(selector), `${path} rendered`);
  return { teardown, html: () => container.innerHTML, text: () => container.textContent ?? '' };
}

function renderHome(t) {
  return renderRoute(t, '/', '.mk-faq-item');
}

test('FAQ items are collapsed accordions that open and close one at a time', async (t) => {
  await renderHome(t);
  const items = [...document.querySelectorAll('.mk-faq-item')];
  assert.ok(items.length >= 6, `expected a real FAQ list, found ${items.length} items`);

  for (const item of items) {
    const button = item.querySelector('h3 > button');
    assert.ok(button, 'each question is a real button, not a heading alone');
    assert.equal(button.getAttribute('aria-expanded'), 'false', 'questions start closed');
    const panelId = button.getAttribute('aria-controls');
    const panel = document.getElementById(panelId);
    assert.ok(panel, 'aria-controls points at the answer panel');
    assert.equal(panel.getAttribute('role'), 'region');
    assert.equal(panel.getAttribute('aria-labelledby'), button.id);
    assert.ok(panel.hasAttribute('inert'), 'a closed answer is inert, so it cannot be read or focused');
    assert.ok(panel.textContent.trim().length > 0, 'the answer is in the DOM before it is animated open');
  }

  const first = items[0];
  const firstButton = first.querySelector('h3 > button');
  const firstPanel = document.getElementById(firstButton.getAttribute('aria-controls'));

  await act(async () => { firstButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(firstButton.getAttribute('aria-expanded'), 'true', 'clicking opens the answer');
  assert.equal(firstPanel.hasAttribute('inert'), false, 'an open answer is reachable again');
  assert.match(firstPanel.className, /mk-faq-item__panel/);

  await act(async () => { firstButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(firstButton.getAttribute('aria-expanded'), 'false', 'clicking again closes it');
  assert.ok(firstPanel.hasAttribute('inert'));
});

test('the homepage footer credits Emerald without a personal name, and keeps the column layout', async (t) => {
  await renderHome(t);
  const footer = document.querySelector('.mk-footer');
  assert.ok(footer, 'the public footer renders');
  const columns = [...footer.querySelectorAll('.mk-footer__column h2')].map(heading => heading.textContent);
  assert.deepEqual(columns, ['Product', 'Resources', 'Legal', 'Providers'], 'footer keeps its link columns and the provider block');

  // Both providers are named, with their own marks, in the footer block.
  const providers = footer.querySelector('.mk-footer__column--providers');
  assert.match(providers.textContent, /Google Forms/, 'Google Forms is named');
  assert.match(providers.textContent, /Create and import/, 'the Typeform row explains what it is for');
  assert.equal(providers.querySelectorAll('svg').length, 2, 'both provider marks render');
  assert.equal(providers.querySelector('svg[aria-label="Google Forms"]'), null, 'the mark is decorative next to its name');

  const credit = footer.querySelector('.mk-footer__credit');
  assert.ok(credit, 'the footer has a credit line');
  // The credit names the designer and the email provider; it still never names a person.
  assert.match(credit.textContent ?? '', /^Designed by Emerald · Email by Calder$/);
  assert.equal(credit.querySelector('a')?.getAttribute('href'), 'https://emerald.pxxl.click');
  assert.doesNotMatch(footer.textContent ?? '', /Oluwadare/, 'no personal name in the footer');
  assert.match(footer.textContent ?? '', /© \d{4} Intake/);
});

test('the homepage ships motion primitives, a menu sheet and no unfinished-work wording', async (t) => {
  const home = await renderHome(t);
  const text = home.text();

  // Scroll reveals and the animated example strip exist in the markup.
  assert.ok(document.querySelectorAll('.mk-reveal').length >= 10, 'sections animate in as they are reached');
  assert.ok(document.querySelector('.mk-marquee__track'), 'the example strip is rendered');
  assert.ok(document.querySelectorAll('.mk-marquee__row').length === 2, 'the strip duplicates its row for a seamless loop');

  // The mobile navigation is a real overlay with a labelled toggle.
  const toggle = document.querySelector('.mk-menu-toggle');
  assert.ok(toggle, 'small screens get a menu toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  const sheet = document.getElementById(toggle.getAttribute('aria-controls'));
  assert.ok(sheet?.className.includes('mk-sheet'));
  await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(sheet.className.includes('is-open'));
  await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  // The product preview switches between creation and editing.
  const switches = [...document.querySelectorAll('.mk-preview-switch button')];
  assert.equal(switches.length, 2);
  assert.equal(switches[0].getAttribute('aria-pressed'), 'true');
  await act(async () => { switches[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(document.querySelectorAll('.mk-preview-switch button')[1].getAttribute('aria-pressed'), 'true');

  for (const phrase of [/not available yet/i, /coming soon/i, /not implemented/i, /display-only/i, /illustrative/i, /AI-powered/i, /AI credits/i, /AI-assisted/i, /natural[- ]language/i, /control layer/i]) {
    assert.doesNotMatch(text, phrase, `the rendered homepage must not say: ${phrase}`);
  }
});

test('the pricing page sends Pro to a real next step instead of an unfinished checkout', async (t) => {
  const page = await renderRoute(t, '/pricing', '.pricing-plan-action');
  const text = page.text();

  // Free has one real action. Pro is not on sale yet, so its next step is a working waitlist form
  // rather than a checkout that cannot finish.
  const actions = [...document.querySelectorAll('.pricing-plan-action')];
  assert.equal(actions.length, 1, 'the free plan has exactly one action');
  assert.equal(actions[0].tagName, 'A');
  assert.equal(document.getElementById('payment-status'), null, 'the old payment notice is gone');
  assert.equal(actions[0].getAttribute('href'), '/waitlist', 'the free plan follows the same wait-list gate as every other CTA');

  const proCard = document.querySelector('.pricing-plan-card.is-pro');
  assert.ok(proCard.querySelector('.pricing-waitlist form'), 'Pro offers a waitlist form, not a dead button');
  assert.match(proCard.textContent, /Pro is not on sale yet\./);
  assert.equal(proCard.querySelector('a.button, a.btn'), null, 'Pro never links to a checkout that does not exist');

  // During free launch the pricing page is allowed to say Pro and packs are coming soon,
  // but no other unfinished-work, billing-status, or AI-marker wording survives on the page.
  assert.match(text, /coming soon/i, 'the pricing page says paid plans are coming soon');
  for (const phrase of [/does not take payments/i, /not available yet/i, /not implemented/i, /display-only/i, /not on this page/i, /AI-powered/i, /AI credits/i, /AI-assisted/i, /natural[- ]language/i, /control layer/i]) {
    assert.doesNotMatch(text, phrase, `the pricing page must not say: ${phrase}`);
  }

  // The monthly and annual switch still compares the real future Pro prices.
  const annual = [...document.querySelectorAll('.pricing-cadence button')].find(button => /Annual/.test(button.textContent));
  assert.ok(annual, 'the cadence switch is present');
  await act(async () => { annual.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.match(document.querySelector('.pricing-plan-card.is-pro .pricing-amount').textContent, /\$69\.00/);
});

test('the homepage shows both provider marks where the promise is made', async (t) => {
  await renderHome(t);

  // Hero: the two targets are named and drawn before the visitor reads a single feature.
  const strip = document.querySelector('.mk-hero .mk-providers');
  assert.ok(strip, 'the hero carries the provider strip');
  const items = [...strip.querySelectorAll('.mk-provider')];
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Google Forms/);
  assert.match(items[0].textContent, /Create and edit in place/);
  assert.match(items[1].textContent, /Typeform/);
  assert.match(items[1].textContent, /Create and import/);
  assert.equal(strip.querySelectorAll('svg').length, 2, 'both marks are drawn, not just named');
  // The marks are decorative next to their names, so screen readers hear the label once.
  for (const svg of strip.querySelectorAll('svg')) assert.equal(svg.getAttribute('aria-hidden'), 'true');

  const heroText = document.querySelector('.mk-hero').textContent;
  assert.match(heroText, /Google Forms or Typeform/, 'the hero lede names both targets');
  assert.doesNotMatch(heroText, /creates and edits Google Forms from a plain-English description/, 'the old Google-only promise is gone');

  // Connection section: Intake connects to either account, and says which one can be edited.
  const connection = document.querySelector('#providers');
  assert.ok(connection, 'the connection section exists');
  assert.match(connection.textContent, /Your forms stay in your account/);
  assert.match(connection.textContent, /Google/);
  assert.match(connection.textContent, /Typeform/);
  assert.match(connection.textContent, /editing is next/);
  assert.equal(connection.querySelectorAll('svg[role="img"], svg[aria-hidden="true"]').length >= 2, true);
});
