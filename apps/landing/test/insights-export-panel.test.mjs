/**
 * What a person sees when they press "Download all responses".
 *
 * The export is a file, so the failure modes are quiet by nature — a download that never starts and
 * a download that half started look identical from the outside. This screen is what makes them
 * different: it names the missing permission, says when there is nothing to export, and reports a
 * file that stopped early as stopped. These tests mount the real component and press the real
 * button.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/app/library', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { Insights } = await import('../src/app/components/Insights.tsx');

after(() => dom.window.close());

const FORM = {
  id: 'form-1',
  provider: 'google',
  providerFormId: 'google-form-1',
  title: 'Feedback',
  status: 'created',
  failureStage: null,
  editUrl: null,
  responderUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  description: null,
  source: 'created',
  lastSyncedAt: null,
  archivedAt: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const RETURN_TO = '/app/library?insights=form-1';

function ready(totalResponses = 3) {
  return {
    status: 'ready',
    formId: 'form-1',
    title: 'Feedback',
    insights: {
      totalResponses,
      truncated: false,
      questions: totalResponses === 0 ? [] : [{ id: 'q1', title: 'How was it?', kind: 'choice', answered: totalResponses, choices: [{ label: 'Good', count: totalResponses }] }],
    },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A CSV body with the closing line the server writes. */
function csvBody(count, extra = '') {
  return `# Exported from Intake - intake.calder.click\r\n\r\nResponse ID,Submitted at\r\nr1,2026-11-06T09:00:00Z\r\n${extra}# End of export. ${count} responses written.\r\n`;
}

function csvResponse(body, filename = 'intake-form-responses-2026-11-06.csv') {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  });
}

/**
 * Mount the real modal. `exportHandler` answers the CSV request; insights always answers with
 * `insights`.
 */
async function mount(t, options = {}) {
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const downloads = [];
  URL.createObjectURL = () => 'blob:intake-export';
  URL.revokeObjectURL = () => {};
  // Downloads are recorded, not performed; the modal's cleanup timer is left to run out.
  // jsdom does not navigate on a click, but it does not record the download either: record it.
  const realClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function click() { downloads.push({ href: this.href, download: this.download }); };

  const requests = [];
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    requests.push({ target, init });
    if (target.includes('/insights/export.csv')) return options.exportHandler(target, init);
    return json(options.insights ?? ready());
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Insights, {
    form: FORM,
    onClose: () => {},
    isPro: true,
    canReadResponses: true,
    needsReconnect: false,
    returnTo: RETURN_TO,
  })));
  for (let i = 0; i < 40; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    if (container.querySelector('.insights-footer') || container.querySelector('.insights-pro-required')) break;
  }

  const view = {
    container,
    requests,
    downloads,
    text: () => container.textContent ?? '',
    button: () => [...container.querySelectorAll('button')].find(element => /Download all responses|Preparing CSV/.test(element.textContent ?? '')) ?? null,
    status: () => container.querySelector('.insights-export-status')?.textContent?.trim() ?? '',
    async press() {
      const button = view.button();
      assert.ok(button, 'the export button is on the screen');
      await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      for (let i = 0; i < 20; i++) {
        if (!view.button()?.textContent?.includes('Preparing')) break;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      }
    },
    async restore() {
      await act(async () => root.unmount());
      container.remove();
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      dom.window.HTMLAnchorElement.prototype.click = realClick;
    },
  };
  t.after(view.restore);
  return view;
}

test('the export is one visible action on the insights screen, not a trip through another page', async t => {
  const view = await mount(t, { exportHandler: () => csvResponse(csvBody(3)) });
  assert.equal(view.container.querySelectorAll('.insights-export').length, 1);
  assert.match(view.button().textContent, /Download all responses \(CSV\)/);
  assert.match(view.text(), /One row per response/);
  assert.equal(view.downloads.length, 0, 'nothing downloads until it is asked for');
});

test('pressing the button downloads the file the server named, and says how many rows are in it', async t => {
  const view = await mount(t, { exportHandler: () => csvResponse(csvBody(3)) });
  await view.press();

  assert.equal(view.downloads.length, 1);
  assert.equal(view.downloads[0].download, 'intake-form-responses-2026-11-06.csv');
  assert.match(view.status(), /Saved intake-form-responses-2026-11-06\.csv/);
  assert.match(view.status(), /3 responses/);
  assert.doesNotMatch(view.status(), /stopped early/i);
});

test('a single response is described in the singular, because a person notices that', async t => {
  const view = await mount(t, { exportHandler: () => csvResponse(csvBody(1)) });
  await view.press();
  assert.match(view.status(), /1 response\./);
});

test('a missing permission offers the same one action as the summary does', async t => {
  const view = await mount(t, {
    exportHandler: () => json({ error: 'Enable response reading first.', code: 'responses_scope_required' }, 403),
  });
  await view.press();

  assert.equal(view.downloads.length, 0);
  assert.match(view.text(), /Allow response reading/);
  assert.equal(view.container.querySelector('form')?.getAttribute('action')?.startsWith('/api/providers/google/extend'), true);
});

test('a connection Google no longer accepts sends the person to reconnect', async t => {
  const view = await mount(t, {
    exportHandler: () => json({ error: 'Google refused the request. Reconnect Google Forms.', code: 'reauthorization_required' }, 403),
  });
  await view.press();

  assert.equal(view.downloads.length, 0);
  assert.match(view.text(), /Connect Google Forms/);
});

test('a form with no responses explains itself instead of downloading an empty file', async t => {
  const view = await mount(t, {
    insights: ready(0),
    exportHandler: () => json({ error: 'This form has no responses yet. Share it and responses will show up here.', code: 'no_responses' }, 404),
  });
  assert.match(view.text(), /No responses to export yet/);
  assert.equal(view.button().disabled, true, 'the button says so before it is pressed');

  // Even if the state were stale, the server answer is handled the same way.
  await view.press();
  assert.equal(view.downloads.length, 0);
});

test('a server that says there is nothing to export is believed even when the count looked fine', async t => {
  const view = await mount(t, {
    insights: ready(3),
    exportHandler: () => json({ error: 'This form has no responses yet. Share it and responses will show up here.', code: 'no_responses' }, 404),
  });
  await view.press();

  assert.equal(view.downloads.length, 0);
  assert.match(view.status(), /no responses yet/i);
});

test('an export that stopped early is never reported as complete', async t => {
  const body = '# Exported from Intake - intake.calder.click\r\n\r\nResponse ID,Submitted at\r\nr1,2026-11-06T09:00:00Z\r\n# INCOMPLETE: 1 responses were written before this happened. Google did not answer. Export again in a few minutes.\r\n';
  const view = await mount(t, { exportHandler: () => csvResponse(body) });
  await view.press();

  assert.match(view.status(), /stopped early/i);
  assert.match(view.status(), /export again/i);
  assert.doesNotMatch(view.status(), /\b3 responses\b/, 'it must not claim more rows than it wrote');
});

test('a refusal or a crash is shown as a plain message, with no error code', async t => {
  const view = await mount(t, { exportHandler: () => json({ error: 'Google did not answer. Try again shortly.' }, 502) });
  await view.press();

  assert.equal(view.downloads.length, 0);
  assert.match(view.status(), /Google did not answer/);
  assert.doesNotMatch(view.text(), /502|code|undefined/);
});

test('being asked to wait is said in words a person can act on', async t => {
  const view = await mount(t, { exportHandler: () => json({ error: 'Too many requests.' }, 429) });
  await view.press();
  assert.match(view.status(), /wait a few minutes/i);
});

test('the export asks the endpoint for this form, and nothing else', async t => {
  const view = await mount(t, { exportHandler: () => csvResponse(csvBody(2)) });
  await view.press();

  const exportRequests = view.requests.filter(request => request.target.includes('export.csv'));
  assert.equal(exportRequests.length, 1);
  assert.equal(exportRequests[0].target, '/api/forms/form-1/insights/export.csv');
  assert.equal(exportRequests[0].init.credentials, 'same-origin', 'the request carries the session');
});
