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
