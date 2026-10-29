import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from '../server/email/templates.ts';
import { providerLabel } from '../server/providers/registry.ts';

/**
 * The email an operator received said "typeform was disconnected from Intake".
 *
 * Two things went wrong and neither was the template: the provider's name was never looked up
 * (the notification layer carried the raw id), and nothing guaranteed that a line starts with a
 * capital. Both are fixed here — the name comes from the provider registry, and the line starts
 * with a capital whatever it is handed.
 */

const VARIABLES = {
  providerName: 'Typeform',
  accountLabel: 'ada@example.com',
  timestamp: '29 October 2026, 12:55 WAT',
  connectionsUrl: 'https://intake.example/app/connections',
};

test('a provider is named the way the product names it', () => {
  assert.equal(providerLabel('typeform'), 'Typeform');
  assert.equal(providerLabel('google'), 'Google Forms');
  assert.equal(providerLabel('microsoft'), 'Microsoft Forms');
  // A provider the registry does not know is named by its own id, never by another provider.
  assert.equal(providerLabel('surveyor'), 'surveyor');
});

test('a provider notice names the provider, in the subject and in the heading', () => {
  const rendered = renderEmail('provider_connection_removed', { ...VARIABLES });
  assert.equal(rendered.subject, 'Typeform was disconnected from Intake');
  assert.match(rendered.html, /Typeform disconnected/, 'the heading names the provider');
  assert.doesNotMatch(rendered.subject, /^typeform/, 'a subject line does not start in lower case');
});

test('a provider name handed over in lower case still starts the line properly', () => {
  const rendered = renderEmail('provider_connection_removed', { ...VARIABLES, providerName: 'typeform' });
  assert.equal(rendered.subject, 'Typeform was disconnected from Intake');
  assert.match(rendered.html, /Typeform disconnected/);
});

test('the details table lines its values up under each other', () => {
  const rendered = renderEmail('provider_connection_removed', { ...VARIABLES });
  // The label column has a width of its own, so every value starts in the same place. Without it,
  // the table hands the spare width to the first column and the values step in and out.
  const labels = [...rendered.html.matchAll(/<td width="(\d+)" valign="top" style="width:\d+px/g)].map(match => match[1]);
  assert.ok(labels.length > 0, 'the details table gives its label column a width');
  assert.equal(new Set(labels).size, 1, 'every label column is the same width');
  assert.match(rendered.html, /<td valign="top" style="padding:7px 0[^"]*"/, 'the value column starts where the label ends');
});

test('the mark in the header lines up with the text in the card', () => {
  const rendered = renderEmail('provider_connection_removed', { ...VARIABLES });
  // The card's text is inset by the shell's padding; the mark is padded to the same column.
  const brand = rendered.html.match(/class="shell-brand"[^>]*style="([^"]*)"/);
  assert.ok(brand, 'the header row carries the shell padding');
  assert.match(brand[1], /padding:0 38px/, 'the mark sits on the text column, not to the left of it');
  assert.match(rendered.html, /\.shell-brand\{padding-left:24px/, 'and it tightens on a narrow screen');
});
