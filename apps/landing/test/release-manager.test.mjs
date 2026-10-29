import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { createReleaseService } from '../server/releases/service.ts';
import { createMemoryReleaseStore } from '../server/releases/memory-store.ts';
import { createReleaseAdminRouter } from '../server/releases/routes.ts';
import { createPublicReleaseRouter } from '../server/releases/public-routes.ts';
import { handleGitHubWebhook, githubWebhookHandler } from '../server/releases/webhooks.ts';
import { verifyGitHubSignature, parsePullRequestReference } from '../server/releases/github.ts';
import { buildDraft, categoriesFromLabels } from '../server/releases/drafting.ts';
import { buildShareCopy, buildShareCopyWithinLimit } from '../server/releases/share.ts';
import { evaluateChecklist } from '../server/releases/checklist.ts';

const ORIGIN = 'https://intake.test';
const WEBHOOK_SECRET = 'whsec_test';
const ADMIN = { id: 'admin-1', name: 'Operator', email: 'operator@intake.test' };

function sign(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

const openServers = [];

/** Every server started by a test is closed when the file finishes, so the runner can exit. */
after(() => {
  for (const server of openServers) server.close();
});

async function boot(options = {}) {
  const store = options.store ?? createMemoryReleaseStore();
  const service = createReleaseService({ store, now: () => new Date('2026-10-29T12:00:00Z') });
  const app = express();
  app.use('/api/admin/releases', (req, _res, next) => { req.res.locals.admin = ADMIN; next(); }, createReleaseAdminRouter({
    service,
    publicOrigin: ORIGIN,
    github: options.github,
    env: {},
  }));
  app.use(createPublicReleaseRouter({ store }));
  app.post('/api/webhooks/github', githubWebhookHandler({
    store,
    service,
    secret: options.webhookSecret ?? WEBHOOK_SECRET,
    autoPublish: false,
    onError: options.onError,
  }));
  const server = createServer(app);
  openServers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, body, extraHeaders = {}) {
    // A string body is sent verbatim: the webhook signs raw bytes, not a re-encoded object.
    const payload = body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) };
    const headers = { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders };
    const response = await fetch(base + path, {
      method,
      headers,
      ...payload,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* empty body */ }
    return { status: response.status, json, text };
  }
  return { store, service, server, base, call };
}

const READY_BODY = [
  '## What changed',
  'The changelog grew a page of its own.',
  '',
  '## Why it matters',
  'Every release can now be linked.',
].join('\n');

async function confirmManualChecklist(call, id) {
  for (const key of ['tests', 'typecheck', 'migrations', 'documentation', 'claims', 'preview']) {
    await call('POST', `/api/admin/releases/${id}/checklist`, { key, decision: 'confirmed', note: 'Checked in this session.' });
  }
  await call('POST', `/api/admin/releases/${id}/checklist`, { key: 'deployment', decision: 'not_applicable', note: 'No deployment for this release.' });
}

test('a release walks draft → review → approved → published, and the checklist gates the last step', async t => {
  const { server, call } = await boot();
  t.after(() => server.close());

  const created = await call('POST', '/api/admin/releases', {
    title: 'Every release has a page',
    summary: 'The changelog is no longer one long list.',
    body: READY_BODY,
    categories: ['improvement'],
    releaseDate: '2026-10-29',
  });
  assert.equal(created.status, 201);
  const id = created.json.release.id;
  assert.equal(created.json.release.status, 'draft');
  assert.equal(created.json.release.slug, 'every-release-has-a-page');

  // A draft must not be visible to the public, and its slug must not be discoverable.
  const list = await call('GET', '/api/releases');
  assert.equal(list.json.releases.length, 0);
  const hidden = await call('GET', '/api/releases/every-release-has-a-page');
  assert.equal(hidden.status, 404);

  assert.equal((await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' })).status, 409,
    'a draft cannot jump straight to published');

  await call('POST', `/api/admin/releases/${id}/state`, { action: 'submit' });
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'approve' });

  const blocked = await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'checklist_incomplete');
  assert.ok(blocked.json.blockers.length > 0, 'the blockers are named');

  await confirmManualChecklist(call, id);
  const published = await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });
  assert.equal(published.status, 200);
  assert.equal(published.json.release.status, 'published');
  assert.ok(published.json.release.publishedAt, 'the publication time is recorded');

  const visible = await call('GET', '/api/releases/every-release-has-a-page');
  assert.equal(visible.status, 200);
  assert.equal(visible.json.release.title, 'Every release has a page');
  assert.equal((await call('GET', '/api/releases')).json.releases.length, 1);

  // The audit trail records who did what.
  const detail = await call('GET', `/api/admin/releases/${id}`);
  const actions = detail.json.audit.map(entry => entry.action);
  for (const action of ['created', 'submitted', 'approved', 'published']) assert.ok(actions.includes(action), `${action} is audited`);
});

test('a published release keeps its permanent slug, and a correction does not change it', async t => {
  const { server, call } = await boot();
  t.after(() => server.close());
  const created = await call('POST', '/api/admin/releases', {
    title: 'Typeform joins Google Forms',
    summary: 'Create a form in Google Forms or Typeform.',
    body: READY_BODY,
    categories: ['feature'],
  });
  const id = created.json.release.id;
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'submit' });
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'approve' });
  await confirmManualChecklist(call, id);
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });

  const renamed = await call('PUT', `/api/admin/releases/${id}`, { slug: 'typeform-joins-google-forms-v2' });
  assert.equal(renamed.status, 409);
  assert.equal(renamed.json.error, 'slug_locked');

  const corrected = await call('PUT', `/api/admin/releases/${id}`, { summary: 'Create a form in Google Forms or Typeform, from one description.' });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.json.release.slug, 'typeform-joins-google-forms');

  // The console sends the whole form, including the slug. Saving a published entry must not fail
  // because the slug came back unchanged.
  const resaved = await call('PUT', `/api/admin/releases/${id}`, {
    slug: 'typeform-joins-google-forms',
    summary: 'Create a form in Google Forms or Typeform, from one description.',
  });
  assert.equal(resaved.status, 200);
  assert.equal(resaved.json.release.slug, 'typeform-joins-google-forms');
  const publicView = await call('GET', '/api/releases/typeform-joins-google-forms');
  assert.equal(publicView.json.release.summary, 'Create a form in Google Forms or Typeform, from one description.');
});

test('a linked deployment that has not succeeded blocks publication, and a failed one says so', async t => {
  const { server, call, store, service } = await boot();
  t.after(() => server.close());
  const created = await call('POST', '/api/admin/releases', {
    title: 'A release with a deployment',
    summary: 'The release waits for production.',
    body: READY_BODY,
    categories: ['feature'],
  });
  const id = created.json.release.id;
  await call('POST', `/api/admin/releases/${id}/sources`, { kind: 'deployment', ref: 'main' });
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'submit' });
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'approve' });
  for (const key of ['tests', 'typecheck', 'migrations', 'documentation', 'claims', 'preview']) {
    await call('POST', `/api/admin/releases/${id}/checklist`, { key, decision: 'confirmed' });
  }

  const blocked = await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });
  assert.equal(blocked.status, 409, 'an unobserved deployment is not a successful deployment');
  const deploymentBlocker = blocked.json.blockers.find(item => item.key === 'deployment');
  assert.ok(deploymentBlocker, 'the deployment check is named as the blocker');
  assert.match(deploymentBlocker.detail, /no observed status|unknown/i);

  // A failed deployment is reported as a failure, not as an unknown.
  const [source] = await store.listSources(id);
  await service.updateSource(ADMIN, id, source.id, { deploymentState: 'failure', deploymentEnvironment: 'production' });
  const failed = await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });
  assert.equal(failed.status, 409);
  assert.match(failed.json.blockers.find(item => item.key === 'deployment').detail, /failure/i);

  await service.updateSource(ADMIN, id, source.id, { deploymentState: 'success', deploymentEnvironment: 'production' });
  const published = await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });
  assert.equal(published.status, 200);
  assert.ok(source);
});

test('release notes that still contain a TODO marker are refused', async t => {
  const { server, call } = await boot();
  t.after(() => server.close());
  const created = await call('POST', '/api/admin/releases', {
    title: 'A draft with a placeholder',
    summary: 'The notes are not finished.',
    body: '## What changed\nTODO — write this section before publishing.',
    categories: ['feature'],
  });
  const id = created.json.release.id;
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'submit' });
  await call('POST', `/api/admin/releases/${id}/state`, { action: 'approve' });
  await confirmManualChecklist(call, id);
  const blocked = await call('POST', `/api/admin/releases/${id}/state`, { action: 'publish' });
  assert.equal(blocked.status, 409);
  const contentBlocker = blocked.json.blockers.find(item => item.key === 'content');
  assert.ok(contentBlocker, 'the unfinished notes are named as the blocker');
  assert.match(contentBlocker.detail, /TODO/);
});

test('invalid slugs and categories are refused with field errors', async t => {
  const { server, call } = await boot();
  t.after(() => server.close());
  const badSlug = await call('POST', '/api/admin/releases', { title: 'A release', slug: 'Not A Slug', summary: 'x'.repeat(20), categories: ['feature'] });
  assert.equal(badSlug.status, 400);
  assert.ok(badSlug.json.fieldErrors.slug, 'the slug is named');

  const badCategory = await call('POST', '/api/admin/releases', { title: 'A release', summary: 'x'.repeat(20), categories: ['marketing'] });
  assert.equal(badCategory.status, 400);
  assert.ok(badCategory.json.fieldErrors.categories);

  const noCategory = await call('POST', '/api/admin/releases', { title: 'A release', summary: 'x'.repeat(20), categories: [] });
  assert.equal(noCategory.status, 400);
});

test('the checklist tells the truth: manual checks are unconfirmed until a person confirms them', () => {
  const release = {
    id: 'rel-1', slug: 'a-release', title: 'A release', summary: 'A summary.', body: READY_BODY,
    categories: ['feature'], status: 'draft', releaseDate: '2026-10-29', links: [], heroImageUrl: null,
    shareText: null, authorUserId: 'admin-1', authorName: 'Operator', authorEmail: 'operator@intake.test',
    approvedByUserId: null, approvedAt: null, publishedAt: null, publishedByUserId: null,
    createdAt: new Date('2026-10-29T10:00:00Z'), updatedAt: new Date('2026-10-29T10:00:00Z'),
  };
  const items = evaluateChecklist({ release, sources: [], decisions: [] });
  const byKey = Object.fromEntries(items.map(item => [item.key, item]));
  assert.equal(byKey.tests.status, 'unconfirmed');
  assert.equal(byKey.tests.kind, 'manual');
  assert.equal(byKey.deployment.status, 'unknown');
  assert.equal(byKey.deployment.kind, 'automatic');
  assert.equal(byKey.approval.status, 'blocked');
  assert.equal(byKey.content.status, 'verified');
});

test('a GitHub webhook delivery is applied once, and a repeat is acknowledged and ignored', async () => {
  const { store, service } = await boot();
  const secret = 'whsec_test';
  const release = {
    id: 'rel-2', slug: 'linked-release', title: 'Linked release', summary: 'A summary.', body: READY_BODY,
    categories: ['feature'], status: 'draft', releaseDate: '2026-10-29', links: [], heroImageUrl: null,
    shareText: null, authorUserId: 'admin-1', authorName: 'Operator', authorEmail: 'operator@intake.test',
    approvedByUserId: null, approvedAt: null, publishedAt: null, publishedByUserId: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
  await store.create({ release });
  await store.addSource({
    id: 'src-1', releaseId: 'rel-2', kind: 'pull_request', provider: 'github', externalId: '21',
    url: 'https://github.com/Emerald-dev0/Intake/pull/21', title: 'Original title', detail: null, labels: [],
    state: 'open', deploymentState: null, deploymentEnvironment: null, deploymentRef: null, deploymentSha: null,
    createdAt: new Date(), updatedAt: new Date(),
  });

  const body = JSON.stringify({
    action: 'closed',
    pull_request: { number: 21, title: 'Renamed pull request', body: 'Body', state: 'closed', merged: true, html_url: 'https://github.com/Emerald-dev0/Intake/pull/21', labels: [{ name: 'release:feature' }] },
  });
  const first = await handleGitHubWebhook(
    { store, service, secret, autoPublish: false },
    body,
    { event: 'pull_request', delivery: 'delivery-1', signature: sign(body, secret) },
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, undefined);
  const [source] = await store.listSources('rel-2');
  assert.equal(source.title, 'Renamed pull request');
  assert.equal(source.state, 'merged');

  const second = await handleGitHubWebhook(
    { store, service, secret, autoPublish: false },
    body,
    { event: 'pull_request', delivery: 'delivery-1', signature: sign(body, secret) },
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.deepEqual(store.deliveries(), ['delivery-1']);
});

test('a webhook with a bad signature or no configured secret is refused', async () => {
  const { store, service } = await boot();
  const body = JSON.stringify({ action: 'closed' });
  const bad = await handleGitHubWebhook({ store, service, secret: 'whsec_test', autoPublish: false }, body, {
    event: 'pull_request', delivery: 'delivery-2', signature: 'sha256=deadbeef',
  });
  assert.equal(bad.status, 401);

  const unsigned = await handleGitHubWebhook({ store, service, secret: 'whsec_test', autoPublish: false }, body, {
    event: 'pull_request', delivery: 'delivery-3',
  });
  assert.equal(unsigned.status, 401);

  const unconfigured = await handleGitHubWebhook({ store, service, secret: null, autoPublish: false }, body, {
    event: 'pull_request', delivery: 'delivery-4', signature: sign(body, 'whsec_test'),
  });
  assert.equal(unconfigured.status, 503, 'without a secret the endpoint refuses rather than accepting');
});

test('the GitHub signature scheme is the documented one, and pull request references parse', () => {
  const body = '{"zen":"Keep it logically awesome."}';
  assert.equal(verifyGitHubSignature(body, sign(body, 'secret'), 'secret'), true);
  assert.equal(verifyGitHubSignature(body, sign(body, 'other'), 'secret'), false);
  assert.equal(verifyGitHubSignature(body, undefined, 'secret'), false);
  assert.equal(verifyGitHubSignature(body, sign(body, 'secret'), null), false);
  assert.equal(parsePullRequestReference('#21'), 21);
  assert.equal(parsePullRequestReference('21'), 21);
  assert.equal(parsePullRequestReference('https://github.com/Emerald-dev0/Intake/pull/21'), 21);
  assert.equal(parsePullRequestReference('not a reference'), null);
});

test('a draft is written from the pull request, classified by its release labels, and marked unfinished', () => {
  const pull = {
    number: 21, title: 'Add a permanent page for every release', body: 'Each release gets its own URL.\n\n## What changed\nPages exist now.',
    state: 'closed', merged: true, mergedAt: null, htmlUrl: 'https://github.com/Emerald-dev0/Intake/pull/21',
    author: 'emerald', labels: ['release:feature', 'release:security'], headSha: 'abc1234', baseRef: 'main',
    createdAt: null, changedFiles: 3, additions: 40, deletions: 2, files: ['src/a.ts', 'src/b.ts'],
  };
  const draft = buildDraft(pull);
  assert.equal(draft.title, 'Add a permanent page for every release');
  assert.deepEqual(draft.categories, ['feature', 'security']);
  assert.match(draft.classification, /release:feature/);
  assert.match(draft.summary, /Each release gets its own URL/);
  assert.match(draft.body, /## What changed\nPages exist now\./, 'sections the pull request already wrote are kept');
  assert.match(draft.body, /## Why it matters\nTODO/, 'missing sections are marked as unfinished');
  assert.match(draft.body, /TODO/, 'a draft with placeholders cannot be published as it stands');
  assert.ok(draft.context.some(line => line.includes('#21')), 'the draft records what it was built from');

  const unlabelled = categoriesFromLabels(['chore']);
  assert.deepEqual(unlabelled.categories, ['improvement']);
  assert.match(unlabelled.note, /No release:/);
});

test('the share copy carries the permanent link and stays inside a single post', () => {
  const copy = buildShareCopy({
    title: 'Every release has a page',
    summary: 'Every release now has a permanent link you can share. It never changes.',
    url: 'https://intake.test/changelog/every-release-has-a-page',
  });
  assert.match(copy.text, /https:\/\/intake\.test\/changelog\/every-release-has-a-page/);
  assert.match(copy.text, /Every release has a page/);
  assert.equal(copy.withinLimit, true);

  const long = buildShareCopyWithinLimit({
    title: 'A very long release title that eats most of the room in a post',
    summary: 'x'.repeat(400),
    url: 'https://intake.test/changelog/a-very-long-release-title',
  });
  assert.equal(long.withinLimit, true);
  assert.match(long.text, /https:\/\/intake\.test\/changelog\/a-very-long-release-title/);
});

test('the share endpoint refuses to invent copy for a release that does not exist', async t => {
  const { server, call } = await boot();
  t.after(() => server.close());
  const missing = await call('POST', '/api/admin/releases/rel-missing/share', {});
  assert.equal(missing.status, 404);
});

test('the migrations seed exactly the releases the site bundles', async () => {
  const [sql, bundled] = await Promise.all([
    // Every migration is scanned: the first release migration seeds the shipped history, and each
    // later release brings its own entry.
    readFile('db/migrations/022_release_manager.sql', 'utf8')
      .then(first => readFile('db/migrations/023_release_depth.sql', 'utf8')
        .then(second => readFile('db/migrations/024_release_developers_page.sql', 'utf8')
          .then(third => `${first}\n${second}\n${third}`))),
    import('../src/content/changelog.ts'),
  ]);
  for (const release of bundled.BUNDLED_RELEASES) {
    assert.match(sql, new RegExp(`'${release.slug}'`), `${release.slug} is seeded in a migration`);
  }
  const seeded = [...sql.matchAll(/'rel_[a-z0-9_]+',\s*'([a-z0-9-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(seeded)].sort(), bundled.BUNDLED_RELEASES.map(release => release.slug).sort(),
    'the seeded releases and the bundled releases are the same set');
});

test('the deeper migration carries exactly the copy the site bundles', async () => {
  // The public changelog reads the database first, so the two copies must not drift: a release
  // note that reads one way on the site and another way in the database is a release note nobody
  // can trust.
  const [sql, bundled] = await Promise.all([
    // Every migration is scanned: each release's copy lands in the migration that introduced it.
    readFile('db/migrations/023_release_depth.sql', 'utf8')
      .then(first => readFile('db/migrations/024_release_developers_page.sql', 'utf8').then(second => `${first}\n${second}`)),
    import('../src/content/changelog.ts'),
  ]);
  const escaped = value => value.replace(/'/g, "''");
  for (const release of bundled.BUNDLED_RELEASES) {
    assert.ok(sql.includes(escaped(release.title)), `${release.slug} carries the current title`);
    assert.ok(sql.includes(escaped(release.summary)), `${release.slug} carries the current summary`);
    assert.ok(sql.includes(release.body), `${release.slug} carries the current notes`);
    for (const highlight of release.highlights) {
      assert.ok(sql.includes(escaped(highlight)), `${release.slug} carries the highlight "${highlight.slice(0, 32)}…"`);
    }
    assert.ok(sql.includes(escaped(release.audience ?? '')), `${release.slug} carries its audience line`);
  }
});

test('the webhook answers even when the store fails, instead of leaving GitHub waiting', async t => {
  const errors = [];
  const store = createMemoryReleaseStore();
  const failing = {
    ...store,
    // What a missing migration looks like: the delivery id cannot be recorded.
    recordWebhookDelivery: async () => { throw new Error('relation "release_webhook_event" does not exist'); },
  };
  const { server, call } = await boot({ store: failing, onError: (label, error) => errors.push([label, error]) });
  t.after(() => server.close());

  const body = JSON.stringify({ action: 'closed', pull_request: { number: 21, title: 'A pull request', body: '', state: 'closed', merged: true, labels: [] } });
  const response = await call('POST', '/api/webhooks/github', body, {
    'content-type': 'application/json',
    'x-github-event': 'pull_request',
    'x-github-delivery': 'delivery-fail',
    'x-hub-signature-256': sign(body, WEBHOOK_SECRET),
  });
  // A hang would leave GitHub with a timeout and no way to tell a broken URL from a broken server.
  assert.equal(response.status, 500);
  assert.equal(response.json.ok, false);
  assert.equal(errors.length, 1, 'the failure is logged, not swallowed');
  assert.match(errors[0][0], /webhook/i);
});

test('the migration creates no index expression PostgreSQL would refuse', async () => {
  const sql = await readFile('db/migrations/022_release_manager.sql', 'utf8');
  const statements = [...sql.matchAll(/CREATE INDEX[^;]+;/gi)].map(match => match[0]);
  assert.ok(statements.length >= 5, 'the migration creates the release indexes');
  for (const statement of statements) {
    // Mixing a date column with a timestamptz column needs the timestamp normalised first: the
    // direct date -> timestamptz cast is STABLE, and PostgreSQL refuses a non-immutable function
    // in an index expression ("functions in index expression must be marked IMMUTABLE").
    if (/release_date/.test(statement) && /published_at/.test(statement)) {
      assert.match(statement, /published_at AT TIME ZONE 'UTC'/,
        'a timestamptz column in a date expression is normalised to UTC before it is cast');
    }
  }
});
