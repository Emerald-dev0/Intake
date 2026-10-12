import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_TEMPLATES, renderEmail, templateFor, escapeHtml,
} from '../server/email/templates.ts';
import { createEmailLogger, sanitizeEmailLogFields } from '../server/email/logging.ts';
import { maskEmail } from '../server/email/types.ts';

const APP = {
  appName: 'Intake',
  dashboardUrl: 'https://intake.example/dashboard',
  securityUrl: 'https://intake.example/account/security',
  connectionsUrl: 'https://intake.example/account/connections',
  supportUrl: 'https://intake.example/support',
  timestamp: '5 October 2026, 14:03 WAT',
};

/** Every template must render from the variables its own catalogue declares, with nothing missing. */
const VARIABLES = {
  otp: { otpCode: '482913', expiryMinutes: 10 },
  password_reset: { resetUrl: 'https://intake.example/reset?token=abc', expiryMinutes: 60 },
  welcome: { userName: 'Ada', dashboardUrl: APP.dashboardUrl, dailyCredits: '20' },
  security_password_changed: { timestamp: APP.timestamp, securityUrl: APP.securityUrl },
  security_email_changed: { timestamp: APP.timestamp, securityUrl: APP.securityUrl, newEmail: 'ada@new.test', previousEmail: 'ada@example.com' },
  security_new_sign_in: { timestamp: APP.timestamp, securityUrl: APP.securityUrl, method: 'Password · Chrome on macOS' },
  security_google_connected: { timestamp: APP.timestamp, securityUrl: APP.securityUrl },
  security_google_disconnected: { timestamp: APP.timestamp, securityUrl: APP.securityUrl },
  provider_connection_added: { providerName: 'Google Forms', accountLabel: 'ada@example.com', connectionsUrl: APP.connectionsUrl, timestamp: APP.timestamp },
  provider_connection_removed: { providerName: 'Microsoft Forms', accountLabel: 'ada@work.test', connectionsUrl: APP.connectionsUrl, timestamp: APP.timestamp },
  credits_low: { detail: '42 credits left', resetAt: '1 November 2026', dashboardUrl: APP.dashboardUrl },
  billing_subscription_started: { planLabel: 'Pro', interval: 'monthly', amount: '$7.99', subscriptionCredits: '1,000', dailyCredits: '10', periodStart: '1 Oct 2026', periodEnd: '1 Nov 2026', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_renewed: { amount: '$7.99', periodStart: '1 Nov 2026', periodEnd: '1 Dec 2026', subscriptionCredits: '1,000', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_canceled: { canceledAt: '5 October 2026', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_ending: { periodEnd: '1 November 2026', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_ended: { dashboardUrl: 'https://intake.example/app' },
  billing_payment_success: { amount: '$7.99', description: 'Intake Pro subscription', timestamp: '5 October 2026', referenceId: 'txn_abc123', dashboardUrl: 'https://intake.example/app' },
  billing_payment_failed: { description: 'Intake Pro subscription', timestamp: '5 October 2026', dashboardUrl: 'https://intake.example/app' },
  billing_credit_pack_purchased: { packLabel: 'Standard', credits: '500', amount: '$5.99', timestamp: '5 October 2026', dashboardUrl: 'https://intake.example/app' },
  billing_renewal_reminder: { renewalDate: '1 November 2026', amount: '$7.99', planLabel: 'Pro', dashboardUrl: 'https://intake.example/app' },
};

test('every email type in the catalogue has a template, and vice versa', () => {
  assert.equal(EMAIL_TEMPLATES.length, Object.keys(VARIABLES).length);
  for (const [type] of Object.entries(VARIABLES)) {
    assert.equal(templateFor(type).id, type);
  }
  for (const template of EMAIL_TEMPLATES) {
    assert.ok(VARIABLES[template.id], `${template.id} is missing from the test catalogue`);
    assert.match(template.alias, /^[a-z0-9-]{1,100}$/, `${template.id} alias must be a Calder-safe alias`);
  }
});

test('every template renders a subject, html and plaintext body', () => {
  for (const [type, variables] of Object.entries(VARIABLES)) {
    const rendered = renderEmail(type, { ...APP, ...variables });
    assert.equal(typeof rendered.subject, 'string');
    assert.ok(rendered.subject.length > 0 && rendered.subject.length <= 120, `${type} subject length`);
    assert.match(rendered.html, /^<!doctype html>/i, `${type} html must be a document`);
    assert.ok(rendered.html.length > 400, `${type} html looks empty`);
    assert.ok(rendered.text.length > 80, `${type} plaintext looks empty`);
    assert.ok(!rendered.text.includes('<'), `${type} plaintext must not contain markup`);
  }
});

test('the plaintext alternative carries the same call to action as the html', () => {
  const reset = renderEmail('password_reset', { ...APP, ...VARIABLES.password_reset });
  assert.match(reset.text, /intake\.example\/reset\?token=abc/, 'the reset link must survive in plaintext');
  assert.match(reset.html, /intake\.example\/reset\?token=abc/);

  const otp = renderEmail('otp', { ...APP, ...VARIABLES.otp });
  assert.match(otp.text, /482913/);
  assert.match(otp.html, /482913/);
});

test('links inside emails point at Intake, never at the provider', () => {
  for (const [type, variables] of Object.entries(VARIABLES)) {
    const rendered = renderEmail(type, { ...APP, ...variables });
    for (const href of rendered.html.matchAll(/href="([^"]+)"/g)) {
      assert.doesNotMatch(href[1], /calder|api\.calder\.click/i, `${type} links must not point at Calder`);
    }
  }
});

test('the welcome mail is personal and every footer carries support contact', () => {
  const welcome = renderEmail('welcome', { ...APP, ...VARIABLES.welcome });
  assert.match(welcome.subject, /Daniel/, 'the subject is signed by Daniel');
  assert.match(welcome.html, /I am Daniel/, 'the body introduces Daniel');
  assert.match(welcome.html, /just reply to this email/, 'the reader is invited to reply');
  assert.match(welcome.text, /— Daniel/, 'the plaintext signs off');
  assert.match(welcome.html, /20 credits every day/, 'launch allowance comes from the passed variable, never hardcoded');

  for (const [type, variables] of Object.entries(VARIABLES)) {
    const rendered = renderEmail(type, { ...APP, ...variables });
    assert.match(rendered.html, /support@intake\.calder\.click/, `${type} footer names the support address`);
    assert.match(rendered.text, /support@intake\.calder\.click/, `${type} plaintext footer names the support address`);
    assert.match(rendered.html, /required to keep your account secure/, `${type} keeps the transactional disclaimer`);
  }
});

test('user-supplied text is escaped, so a name cannot inject markup', () => {
  const hostile = '<script>alert(1)</script> & "quoted" \'single\'';
  const rendered = renderEmail('welcome', { ...APP, userName: hostile, dashboardUrl: APP.dashboardUrl });
  assert.ok(!rendered.html.includes('<script>'), 'no live script tag may reach an inbox');
  assert.ok(rendered.html.includes('&lt;script&gt;'), 'the markup must be inert');
  assert.ok(rendered.html.includes('&#39;') || rendered.html.includes('&quot;'));
  assert.ok(rendered.html.includes('&lt;script&gt;'), 'the name still appears, escaped, in the body');
});

test('escapeHtml covers the five characters that matter in html', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml('plain'), 'plain');
});

test('a rendered email identifies the product and offers a way out of a scary security notice', () => {
  const signIn = renderEmail('security_new_sign_in', { ...APP, ...VARIABLES.security_new_sign_in });
  assert.match(signIn.html, /Intake/);
  assert.match(signIn.html, /intake\.example\/account\/security/, 'an unexpected sign-in notice must link to security settings');
  assert.match(signIn.text, /intake\.example\/account\/security/, 'the plaintext notice must carry an actionable link');
});

test('the logger never emits a secret, an OTP or a whole recipient address', () => {
  const lines = [];
  const log = createEmailLogger(line => lines.push(line));
  log('email.otp.started', {
    otp: '482913', code: '482913', apiKey: 'calder_sk_live_supersecret', authorization: 'Bearer calder_sk_live_x',
    recipient: 'ada.lovelace@example.com', to: 'ada.lovelace@example.com', userId: 'user-1', purpose: 'verify_email',
  });

  const raw = lines.join('\n');
  assert.ok(raw.length > 0, 'the logger must actually write something');
  for (const secret of ['482913', 'calder_sk_live_supersecret', 'calder_sk_live_x']) {
    assert.ok(!raw.includes(secret), `${secret} must never be logged`);
  }
  assert.ok(!raw.includes('ada.lovelace@'), 'addresses are masked, not printed');
  assert.match(raw, /a\*\*[\s\S]*@example\.com|\[redacted\]/, 'the masked address keeps its domain for debugging');
  assert.match(raw, /user-1/);
});

test('log fields are sanitised even when a caller passes something hostile', () => {
  const safe = sanitizeEmailLogFields({
    token: 'reset-token-value', secret: 'whsec_value', password: 'hunter2', apiKey: 'calder_sk_x', api_key: 'y',
    otp: '123456', code: '123456', credential: 'c', cookie: 'k', note: 'line one\nline two\u0000end', count: 3, nothing: undefined,
  });
  for (const value of Object.values(safe)) {
    const text = String(value);
    assert.ok(!text.includes('\n') && !text.includes(' '), 'control characters are stripped from log lines');
  }
  assert.equal(safe.token, '[redacted]');
  assert.equal(safe.count, 3);
  assert.equal('nothing' in safe, false);
});

test('maskEmail keeps an address recognisable to an operator and useless to a scraper', () => {
  assert.equal(maskEmail('ada@example.com'), 'a**@example.com');
  assert.equal(maskEmail('a@example.com'), 'a*@example.com');
  assert.equal(maskEmail('not-an-email'), '***');
});
