import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../src/lib/plans.ts';
import { PRICING_DESCRIPTION, PRICING_FAQS, PRICING_TITLE } from '../src/content/pricing.ts';

const SITE_ORIGIN = 'https://intake-six-blue.vercel.app';

test('shared public plan metadata describes the published Free and Pro prices accurately', () => {
  const comparison = proPriceComparison();
  assert.equal(PLAN_CATALOG.free.prices, null);
  assert.equal(PLAN_CATALOG.pro.prices?.month, 799);
  assert.equal(PLAN_CATALOG.pro.prices?.year, 6900);
  assert.equal(comparison.monthlyBilledAnnualTotalCents, 9588);
  assert.equal(comparison.annualSavingsCents, 2688);
  assert.equal(comparison.annualSavingsPercent, 28.0);
  assert.equal(formatUsd(comparison.monthlyCents), '$7.99');
  assert.equal(formatUsd(comparison.annualCents), '$69.00');
  assert.equal(formatUsd(comparison.annualSavingsCents), '$26.88');
});

test('the generated pricing document is crawlable, canonical, and matches its visible FAQ', async () => {
  const html = await readFile('dist/pricing.html', 'utf8');
  const description = html.match(/<meta name="description" content="([^"]*)"\s*\/>/)?.[1];
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"\s*\/>/)?.[1];
  const structured = html.match(/<script id="intake-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];

  assert.ok(html.includes(`<title>${PRICING_TITLE}</title>`));
  assert.equal(canonical, `${SITE_ORIGIN}/pricing`);
  assert.ok(description?.includes('$7.99 per month'));
  assert.ok(description?.includes('$69.00 per year'));
  assert.equal(description, PRICING_DESCRIPTION);
  assert.ok(structured);
  assert.ok(fallback);
  assert.match(fallback, /Free · \$0/);
  assert.match(fallback, /Pro · \$7\.99 per month or \$69\.00 per year/);
  assert.match(fallback, /Pro opens to existing accounts first/);
  assert.match(fallback, /switched on from your account page/);

  const graph = JSON.parse(structured);
  const page = graph['@graph'].find(entity => entity['@type'] === 'WebPage');
  const faq = graph['@graph'].find(entity => entity['@type'] === 'FAQPage');
  assert.equal(page.url, `${SITE_ORIGIN}/pricing`);
  assert.equal(page.name, PRICING_TITLE);
  assert.equal(faq.mainEntity.length, PRICING_FAQS.length);
  assert.doesNotMatch(JSON.stringify(graph), /"@type":"Offer"|"priceCurrency"|"price":/);
  for (const [index, item] of PRICING_FAQS.entries()) {
    const question = faq.mainEntity[index];
    assert.equal(question.name, item.question);
    assert.equal(question.acceptedAnswer.text, item.answer);
    assert.ok(fallback.includes(`<h3>${item.question}</h3>`));
    assert.ok(fallback.includes(`<p>${item.answer}</p>`));
  }
});
