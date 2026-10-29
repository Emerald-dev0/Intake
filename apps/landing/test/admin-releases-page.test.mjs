import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// React DOM chooses its event system at import time; install DOM globals before importing the app.
const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/admin/releases', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { AdminReleasesPage, AdminReleaseDetailPage } = await import('../src/admin/AdminReleasesPage.tsx');
const { AdminReleasePreviewPage } = await import('../src/admin/AdminReleasePreviewPage.tsx');

after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const RELEASE = {
  id: 'rel-1',
  slug: 'every-release-has-a-page',
  title: 'Every release now has its own page',
  summary: 'The changelog is no longer one long list.',
  body: '## What changed\nEach release now has its own address.',
  categories: ['improvement'],
  status: 'in_review',
  releaseDate: '2026-10-29',
  links: [{ label: 'Changelog', url: '/changelog' }],
  heroImageUrl: null,
  shareText: null,
  authorName: 'Operator',
  authorEmail: 'operator@intake.test',
  approvedAt: null,
  publishedAt: null,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-29T09:00:00.000Z',
};

const DETAIL = {
  release: RELEASE,
  sources: [{
    id: 'src-1', releaseId: 'rel-1', kind: 'pull_request', provider: 'github', externalId: '21',
    url: 'https://github.com/Emerald-dev0/Intake/pull/21', title: 'Add a page per release', detail: null,
    labels: ['release:feature'], state: 'merged', deploymentState: null, deploymentEnvironment: null,
    deploymentRef: null, deploymentSha: null, createdAt: '2026-10-28T09:00:00.000Z', updatedAt: '2026-10-28T09:00:00.000Z',
  }],
  audit: [{ id: 'a-1', releaseId: 'rel-1', action: 'created', actorUserId: 'admin-1', actorName: 'Operator', actorEmail: 'operator@intake.test', detail: 'Draft created.', createdAt: '2026-10-28T09:00:00.000Z' }],
  checklist: [
    { key: 'content', label: 'Changelog content prepared', kind: 'automatic', status: 'verified', detail: 'Everything is set.', notApplicable: false },
    { key: 'tests', label: 'Relevant tests passed', kind: 'manual', status: 'unconfirmed', detail: 'Record the test run you relied on.', notApplicable: false },
    { key: 'deployment', label: 'Production deployment succeeded', kind: 'automatic', status: 'unknown', detail: 'No deployment is linked to this release.', notApplicable: false },
    { key: 'approval', label: 'Administrator approval recorded', kind: 'automatic', status: 'blocked', detail: 'No administrator has approved this release yet.', notApplicable: false },
  ],
  readiness: { ready: false, blockers: [] },
  github: { configured: false, repository: null },
  previewUrl: 'https://intake.test/changelog/every-release-has-a-page',
};

async function mount({ path = '/admin/releases', handler }) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), init }); return handler(String(input), init); };
  const router = createMemoryRouter([
    { path: '/admin/releases', element: React.createElement(AdminReleasesPage) },
    { path: '/admin/releases/:releaseId', element: React.createElement(AdminReleaseDetailPage) },
    { path: '/admin/releases/:releaseId/preview', element: React.createElement(AdminReleasePreviewPage) },
  ], { initialEntries: [path] });
  // One container per mount: two roots on the same node make React refuse the second render.
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(RouterProvider, { router })));
  return {
    calls,
    root,
    container,
    text: () => container.textContent ?? '',
    find: label => [...container.querySelectorAll('button')].find(button => button.textContent === label),
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('the release list shows real releases, and an empty store says so instead of inventing rows', async t => {
  const empty = await mount({ handler: path => {
    if (path.startsWith('/api/admin/releases')) return json({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
    return json({ error: 'not found' }, 404);
  } });
  t.after(empty.restore);
  assert.match(empty.text(), /No releases yet/);

  const listed = await mount({ handler: path => {
    if (path.startsWith('/api/admin/releases')) {
      return json({ items: [{ ...RELEASE, sourceCount: 1, hasDeployment: false, deploymentState: null }], total: 1, page: 1, pageSize: 25, totalPages: 1 });
    }
    return json({ error: 'not found' }, 404);
  } });
  t.after(listed.restore);
  assert.match(listed.text(), /Every release now has its own page/);
  assert.match(listed.text(), /\/changelog\/every-release-has-a-page/);
  assert.equal(listed.container.querySelectorAll('tbody tr').length, 1);
});

test('an unavailable release store is an error, never a confident empty list', async t => {
  const view = await mount({ handler: () => json({ error: 'Release storage is temporarily unavailable.' }, 503) });
  t.after(view.restore);
  assert.ok(view.container.querySelector('[role="alert"]'), 'the failure is announced');
  assert.doesNotMatch(view.text(), /No releases yet/);
});

test('the release screen shows the checklist honestly and refuses to publish until it is complete', async t => {
  const view = await mount({
    path: '/admin/releases/rel-1',
    handler: path => {
      if (path === '/api/admin/releases/rel-1') return json(DETAIL);
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  assert.match(view.text(), /Not confirmed/, 'an unconfirmed manual check is not shown as passed');
  assert.match(view.text(), /No deployment is linked/);
  assert.match(view.text(), /Every release now has its own page/);

  const publish = view.find('Publish');
  assert.ok(publish);
  assert.equal(publish.disabled, true, 'publishing is refused while the checklist is incomplete');

  // The release is in review, so approval is the action that is available.
  assert.equal(view.find('Approve').disabled, false);
  assert.equal(view.find('Send for review').disabled, true, 'a release already in review is not sent again');

  // A manual checklist item can be confirmed, and the confirmation is a server write.
  const confirm = view.find('Confirm');
  await act(async () => confirm.click());
  const decision = view.calls.find(call => call.path.endsWith('/checklist'));
  assert.ok(decision, 'the decision is posted to the server');
  assert.equal(decision.init.method, 'POST');
  assert.deepEqual(JSON.parse(decision.init.body), { key: 'tests', decision: 'confirmed' });
});

test('the share composer produces copy, and only claims the clipboard when the clipboard accepted it', async t => {
  const view = await mount({
    path: '/admin/releases/rel-1',
    handler: path => {
      if (path === '/api/admin/releases/rel-1') return json(DETAIL);
      if (path.endsWith('/share')) return json({ text: 'Every release now has its own page\n\nhttps://intake.test/changelog/every-release-has-a-page', withinLimit: true, length: 90 });
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  const write = view.find('Write copy');
  await act(async () => write.click());
  const textarea = view.container.querySelector('.admin-release__share');
  assert.match(textarea.value, /https:\/\/intake\.test\/changelog\/every-release-has-a-page/);

  // No clipboard in this environment: the copy must fail honestly rather than claim success.
  const copy = view.find('Copy');
  await act(async () => copy.click());
  assert.doesNotMatch(view.text(), /copied to the clipboard/i);
  assert.match(view.text(), /clipboard|did not allow/i);
});

test('a GitHub integration that is not configured is stated plainly, with the manual path still offered', async t => {
  const view = await mount({
    path: '/admin/releases/rel-1',
    handler: path => {
      if (path === '/api/admin/releases/rel-1') return json(DETAIL);
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);
  assert.match(view.text(), /GitHub integration is not configured/);
  assert.match(view.text(), /GITHUB_TOKEN/);
  assert.ok(view.find('Link'), 'a source can still be linked by hand');
});

test('the preview shows the public page for an unpublished release, and says it is not published', async t => {
  const view = await mount({
    path: '/admin/releases/rel-1/preview',
    handler: path => {
      if (path === '/api/admin/releases/rel-1/preview') {
        return json({
          release: {
            slug: 'every-release-has-a-page',
            title: 'Every release now has its own page',
            summary: 'The changelog is no longer one long list.',
            body: '## What changed\nEach release now has its own address.',
            categories: ['improvement'],
            releaseDate: '2026-10-29',
            publishedAt: null,
            links: [{ label: 'Changelog', url: '/changelog' }],
            heroImageUrl: null,
          },
          url: 'https://intake.test/changelog/every-release-has-a-page',
        });
      }
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  assert.match(view.text(), /Preview · not published/);
  assert.match(view.text(), /Every release now has its own page/);
  assert.match(view.text(), /What changed/);
  assert.match(view.text(), /https:\/\/intake\.test\/changelog\/every-release-has-a-page/);
});

test('the console saves a release with the method the server exposes', async t => {
  const calls = [];
  const view = await mount({
    path: '/admin/releases/rel-1',
    handler: (path, init) => {
      calls.push({ path, method: init?.method ?? 'GET' });
      if (path === '/api/admin/releases/rel-1' && (init?.method ?? 'GET') === 'GET') return json(DETAIL);
      if (path === '/api/admin/releases/rel-1' && init?.method === 'PUT') return json({ release: RELEASE });
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  const form = view.container.querySelector('form');
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });

  // The server exposes the update as a PUT. A POST would answer 404 and the operator would be
  // told the release could not be saved.
  assert.ok(calls.some(call => call.method === 'PUT' && call.path === '/api/admin/releases/rel-1'),
    'the release is saved with a PUT');
  assert.ok(!calls.some(call => call.method === 'POST' && call.path === '/api/admin/releases/rel-1'),
    'the release is not saved with a POST');
});
