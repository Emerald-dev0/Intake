import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The signed-in page system: one heading, one section, one empty state, one error state, one
 * skeleton, one disclosure.
 *
 * The rule under test is the one this product keeps breaking when it is not written down: an empty
 * result and a failed request are different claims, and they must not share a component.
 */

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/app', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { PageHeader, Section, EmptyState, ErrorState, Skeleton, Disclosure } = await import('../src/app/components/PagePrimitives.tsx');
after(() => dom.window.close());

function Sample() {
  return React.createElement('div', null,
    React.createElement(PageHeader, {
      kicker: 'LIBRARY',
      title: 'Your forms',
      description: 'Everything you made.',
      actions: React.createElement('a', { className: 'btn', href: '/app/forms' }, 'New form →'),
    }),
    React.createElement(Section, {
      id: 'plan',
      eyebrow: 'CURRENT PLAN',
      title: 'Free',
      description: 'What this account can use.',
      actions: React.createElement('button', { type: 'button', className: 'btn' }, 'Compare'),
    }, React.createElement('p', null, 'Body')),
    React.createElement(EmptyState, { title: 'Nothing here yet', detail: 'Make one and it will appear.' }),
    React.createElement(ErrorState, { title: 'Could not load', detail: 'The records are unreachable.', onRetry: () => {} }),
    React.createElement(Skeleton, { label: 'Loading your library', variant: 'card' }),
    React.createElement(Disclosure, { summary: 'How credits work', detail: 'Charging and resets' },
      React.createElement('p', null, 'Inert explanation.')),
  );
}

test('the shared primitives are one heading, one section, one empty state and one error state', async t => {
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); document.getElementById('root').innerHTML = ''; });
  await act(async () => root.render(React.createElement(Sample)));

  const heading = document.querySelector('.ui-head');
  assert.ok(heading);
  assert.equal(heading.querySelector('.ui-kicker').textContent, 'LIBRARY');
  assert.equal(heading.querySelector('h1').textContent, 'Your forms');
  assert.ok(heading.querySelector('.ui-head__actions a'), 'the page action sits in the heading row');

  // Section: the eyebrow both Billing and Account used, kept as one component rather than two.
  const section = document.querySelector('.ui-section');
  assert.equal(section.querySelector('.ui-section__eyebrow').textContent, 'CURRENT PLAN');
  assert.equal(section.querySelector('h2').id, 'plan-title', 'the heading is addressable, so aria-labelledby works');
  assert.equal(section.getAttribute('aria-labelledby'), 'plan-title');
  assert.ok(section.querySelector('.ui-section__actions button'));

  // An empty state is not an alert; an error is. They must not be the same element.
  assert.equal(document.querySelector('.ui-empty')?.getAttribute('role'), null);
  assert.equal(document.querySelector('.ui-error')?.getAttribute('role'), 'alert');
  assert.match(document.querySelector('.ui-error').textContent, /Could not load/);

  const skeleton = document.querySelector('.ui-skeleton');
  assert.equal(skeleton.getAttribute('role'), 'status');
  assert.equal(skeleton.getAttribute('aria-label'), 'Loading your library', 'one labelled announcement, not one per bar');

  // Disclosure hides inert copy, and says what is inside while collapsed.
  const disclosure = document.querySelector('.ui-disclosure');
  assert.equal(disclosure.tagName, 'DETAILS');
  assert.equal(disclosure.open, false, 'collapsed by default');
  assert.match(disclosure.querySelector('summary').textContent, /How credits work.*Charging and resets/s);
  assert.match(disclosure.textContent, /Inert explanation/);
});
