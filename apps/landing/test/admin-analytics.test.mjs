import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createPostgresAnalyticsStore } from '../server/analytics/store.ts';
import { createAnalyticsRouter, referrerHost } from '../server/analytics/routes.ts';
import { resolveCountry } from '../server/analytics/countries.ts';

function fakePool(handler) {
  return {
    async query(sql, params = []) {
      return handler(String(sql), params);
    },
  };
}

const BOUNDS = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') };

test('referrer URLs are reduced to hostnames; anything else becomes empty', () => {
  assert.equal(referrerHost('https://www.google.com/search?q=intake'), 'www.google.com');
  assert.equal(referrerHost('https://X.COM/'), 'x.com');
  assert.equal(referrerHost('not a url'), '');
  assert.equal(referrerHost('ftp://files.example.com/x'), '');
  assert.equal(referrerHost(''), '');
  assert.equal(referrerHost(null), '');
});

test('country resolution prefers edge headers, then timezone, then empty', () => {
  assert.deepEqual(
    resolveCountry({ headers: { 'cf-ipcountry': 'ng' }, timeZone: 'America/New_York' }),
    { country: 'NG', timeZone: 'America/New_York', precise: true },
  );
  assert.deepEqual(
    resolveCountry({ headers: { 'x-vercel-ip-country': 'DE' }, timeZone: '' }),
    { country: 'DE', timeZone: '', precise: true },
  );
  assert.deepEqual(
    resolveCountry({ headers: {}, timeZone: 'Africa/Lagos' }),
    { country: 'NG', timeZone: 'Africa/Lagos', precise: false },
  );
  assert.deepEqual(
    resolveCountry({ headers: { 'cf-ipcountry': 'XX' }, timeZone: 'Mars/Olympus' }),
    { country: 'XX', timeZone: '', precise: true },
  );
  assert.deepEqual(
    resolveCountry({ headers: {}, timeZone: 'Mars/Olympus' }),
    { country: '', timeZone: '', precise: false },
  );
  assert.deepEqual(
    resolveCountry({ headers: {}, timeZone: '' }),
    { country: '', timeZone: '', precise: false },
  );
});

test('timezone mapping covers the IANA table, common aliases, and honest unknowns', () => {
  for (const [zone, code] of [
    ['Asia/Kathmandu', 'NP'], ['Australia/Eucla', 'AU'], ['America/Coyhaique', 'CL'],
    ['Asia/Qostanay', 'KZ'], ['Pacific/Kiritimati', 'KI'], ['America/Argentina/Ushuaia', 'AR'],
    ['US/Eastern', 'US'], ['Canada/Pacific', 'CA'], ['Mexico/BajaNorte', 'MX'],
  ]) {
    assert.equal(resolveCountry({ headers: {}, timeZone: zone }).country, code, zone);
  }
  for (const zone of ['UTC', 'Etc/UTC', 'Etc/GMT+5', 'Mars/Olympus', '', '   ']) {
    assert.equal(resolveCountry({ headers: {}, timeZone: zone }).country, '', `${zone || '(empty)'} is never guessed`);
  }
  assert.equal(resolveCountry({ headers: { 'cf-ipcountry': 'xx' }, timeZone: '' }).country, 'XX');
});

test('analytics are unavailable with a reason before migration 013', async () => {
  const store = createPostgresAnalyticsStore(fakePool(async () => ({ rows: [{ present: null }], rowCount: 1 })));
  const summary = await store.summary(BOUNDS);
  assert.equal(summary.available, false);
  assert.match(summary.reason, /013/);
});

test('summary aggregates events, referrers, sources, clicks, signups and forms', async () => {
  const pool = fakePool(async (sql, params) => {
    if (sql.includes('to_regclass')) return { rows: [{ present: 'site_events' }], rowCount: 1 };
    if (sql.includes('GROUP BY kind')) return { rows: [{ kind: 'pageview', count: '7' }, { kind: 'click', count: '3' }], rowCount: 2 };
    if (sql.includes('FILTER (WHERE kind')) return {
      rows: [
        { day: '2026-10-03', pageviews: '5', clicks: '2' },
        { day: '2026-10-04', pageviews: '2', clicks: '1' },
      ], rowCount: 2,
    };
    if (sql.includes('GROUP BY path')) return { rows: [{ name: '/', count: '6' }, { name: '/pricing', count: '1' }], rowCount: 2 };
    if (sql.includes('referrer_host')) return { rows: [{ name: 'google.com', count: '4' }], rowCount: 1 };
    if (sql.includes('utm_source')) return { rows: [{ name: '(direct)', count: '5' }, { name: 'launch-post', count: '2' }], rowCount: 2 };
    if (sql.includes('GROUP BY label')) return { rows: [{ name: 'Start free', count: '3' }], rowCount: 1 };
    if (sql.includes('GROUP BY country')) return {
      rows: [
        { name: 'NG', count: '4', precise: false },
        { name: 'US', count: '2', precise: true },
      ], rowCount: 2,
    };
    if (sql.includes('FROM "user"')) return { rows: [{ count: '2' }], rowCount: 1 };
    if (sql.includes('FROM form')) return { rows: [{ count: '1' }], rowCount: 1 };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
  const summary = await createPostgresAnalyticsStore(pool).summary(BOUNDS);
  assert.equal(summary.available, true);
  assert.equal(summary.pageviews, 7);
  assert.equal(summary.clicks, 3);
  assert.equal(summary.signups, 2);
  assert.equal(summary.formsCreated, 1);
  assert.deepEqual(summary.byDay[0], { day: '2026-10-03', pageviews: 5, clicks: 2 });
  assert.deepEqual(summary.topReferrers, [{ name: 'google.com', count: 4 }]);
  assert.deepEqual(summary.topClicks, [{ name: 'Start free', count: 3 }]);
  assert.deepEqual(summary.topCountries, [{ name: 'NG', count: 4 }, { name: 'US', count: 2 }]);
  assert.equal(summary.countryPrecise, true);
});

test('the public ingress accepts closed-shape events and rejects everything else', async () => {
  const recorded = [];
  const app = express();
  app.use('/api/analytics', createAnalyticsRouter({
    store: { async record(input) { recorded.push(input); } },
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = body => fetch(`${base}/api/analytics/event`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const ok = await post({
      kind: 'pageview', path: '/pricing', label: '',
      referrer: 'https://t.co/abc?utm=x', utmSource: 'launch', utmMedium: '', utmCampaign: '',
    });
    assert.equal(ok.status, 202);
    assert.deepEqual(recorded[0], {
      kind: 'pageview', path: '/pricing', label: '',
      referrerHost: 't.co', utmSource: 'launch', utmMedium: '', utmCampaign: '',
      country: '', timeZone: '', countryPrecise: false,
    });

    const click = await post({ kind: 'click', path: '/', label: 'Start free', referrer: '' });
    assert.equal(click.status, 202);
    assert.equal(recorded[1].label, 'Start free');

    const edged = await fetch(`${base}/api/analytics/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-ip-country': 'ng' },
      body: JSON.stringify({ kind: 'pageview', path: '/', label: '', referrer: '', timeZone: 'Africa/Lagos' }),
    });
    assert.equal(edged.status, 202);
    assert.deepEqual(
      { country: recorded[2].country, timeZone: recorded[2].timeZone, countryPrecise: recorded[2].countryPrecise },
      { country: 'NG', timeZone: 'Africa/Lagos', countryPrecise: true },
    );

    for (const bad of [
      { kind: 'pageview', path: '/app' },
      { kind: 'pageview', path: '/' + 'x'.repeat(300) },
      { kind: 'click', path: '/', label: '' },
      { kind: 'hover', path: '/' },
      'not-json-shaped',
    ]) {
      const res = await post(bad);
      assert.equal(res.status, 400, `must reject ${JSON.stringify(bad).slice(0, 40)}`);
    }
    assert.equal(recorded.length, 3, 'rejected events are never stored');

    const long = await post({ kind: 'pageview', path: '/', label: '', referrer: '', utmSource: 'x'.repeat(61) });
    assert.equal(long.status, 202, 'oversized optional tags truncate instead of rejecting');
    assert.equal(recorded[3].utmSource, 'x'.repeat(60));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the country provenance migration is additive and honest about history', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../db/migrations/015_analytics_country_precise.sql', import.meta.url), 'utf8');
  const sql = text.replace(/--.*$/gm, '');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS country_precise boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im, 'the migration never deletes or rewrites rows');
  assert.doesNotMatch(sql, /prompt|api_key|credential|token|user_agent/i, 'no secrets or identifiers are stored');
});
