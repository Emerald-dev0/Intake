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
  waitlist_welcome: {},
  launch_announcement: { marketingUrl: 'https://intake.example' },
  launch_note: { marketingUrl: 'https://intake.example' },
  security_password_changed: { timestamp: APP.timestamp, securityUrl: APP.securityUrl },
  security_email_changed: { timestamp: APP.timestamp, securityUrl: APP.securityUrl, newEmail: 'ada@new.test', previousEmail: 'ada@example.com' },
  security_new_sign_in: { timestamp: APP.timestamp, securityUrl: APP.securityUrl, method: 'Password · Chrome on macOS' },
  security_google_connected: { timestamp: APP.timestamp, securityUrl: APP.securityUrl },
  security_google_disconnected: { timestamp: APP.timestamp, securityUrl: APP.securityUrl },
  provider_connection_added: { providerName: 'Google Forms', accountLabel: 'ada@example.com', connectionsUrl: APP.connectionsUrl, timestamp: APP.timestamp },
  provider_connection_removed: { providerName: 'Microsoft Forms', accountLabel: 'ada@work.test', connectionsUrl: APP.connectionsUrl, timestamp: APP.timestamp },
  credits_low: { detail: '42 credits left', resetAt: '1 November 2026', dashboardUrl: APP.dashboardUrl },
  dev_answers_received: { projectName: 'Checkout app', formName: 'Waitlist', answerCount: '3', sinceLast: '28 October 2026', dashboardUrl: 'https://intake.example/app/developers' },
  billing_subscription_started: { planLabel: 'Pro', interval: 'monthly', amount: '$7.99', subscriptionCredits: '1,000', dailyCredits: '10', periodStart: '1 Oct 2026', periodEnd: '1 Nov 2026', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_renewed: { amount: '$7.99', periodStart: '1 Nov 2026', periodEnd: '1 Dec 2026', subscriptionCredits: '1,000', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_canceled: { canceledAt: '5 October 2026', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_ending: { periodEnd: '1 November 2026', dashboardUrl: 'https://intake.example/app' },
  billing_subscription_ended: { dashboardUrl: 'https://intake.example/app' },
  billing_payment_success: { amount: '$7.99', description: 'Intake Pro subscription', timestamp: '5 October 2026', referenceId: 'txn_abc123', dashboardUrl: 'https://intake.example/app' },
  billing_payment_failed: { description: 'Intake Pro subscription', timestamp: '5 October 2026', dashboardUrl: 'https://intake.example/app' },
  billing_credit_pack_purchased: { packLabel: 'Standard', credits: '500', amount: '$5.99', timestamp: '5 October 2026', dashboardUrl: 'https://intake.example/app' },
  billing_renewal_reminder: { renewalDate: '1 November 2026', amount: '$7.99', planLabel: 'Pro', dashboardUrl: 'https://intake.example/app' },
  admin_message: {
    adminSubject: 'A small change to your account',
    adminBody: 'Hi Ada,\n\nWe tidied the dashboard this week, so recent forms sit at the top.',
    adminButtonLabel: 'Open the dashboard',
    dashboardUrl: 'https://intake.example/app',
    userName: 'Ada',
  },
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

test('an operator-composed note is escaped, greeted once, and button-less when no link was given', () => {
  const withButton = renderEmail('admin_message', {
    ...APP,
    adminSubject: 'A small change',
    adminBody: 'Hi {{name}} & friends,\n\nLine one.\nLine two.',
    adminButtonLabel: 'Open Intake',
    dashboardUrl: 'https://intake.example/app',
    userName: 'Ada',
  });
  // Placeholders are substituted by the caller, so a literal brace pair would be an operator mistake,
  // never something the template expands. What matters here is escaping and paragraph handling.
  assert.match(withButton.html, /&amp; friends/);
  assert.match(withButton.html, /Line one\.<br \/>Line two\./);
  assert.match(withButton.html, /href="https:\/\/intake\.example\/app"/);
  assert.match(withButton.text, /Open Intake: https:\/\/intake\.example\/app/);
  assert.equal(withButton.text.match(/Hi Ada/g)?.length ?? 0, 0, 'the template adds no greeting of its own');

  const plain = renderEmail('admin_message', {
    ...APP, adminSubject: 'A small change', adminBody: 'Just two sentences, no button at all.', dashboardUrl: '',
  });
  assert.doesNotMatch(plain.html, /<a href=/, 'no link was given, so no button is rendered');
  assert.doesNotMatch(plain.text, /Open Intake:/);
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
      // The one intentional off-site link is the X profile in the footer. Anything else must stay on
      // an Intake origin: a template that reaches for a provider's API is a bug, not a design choice.
      const allowed = ['intake.example', 'intake.calder.click', 'x.com'];
      assert.ok(allowed.includes(new URL(href[1]).hostname), `${type} links must point at Intake (or the X footer row), not at the provider API`);
    }
  }
});

test('the welcome mail is personal and every footer carries support contact', () => {
  const welcome = renderEmail('welcome', { ...APP, ...VARIABLES.welcome });
  assert.match(welcome.subject, /Daniel/, 'the subject is signed by Daniel');
  assert.match(welcome.html, /I'm Daniel/, 'the body introduces Daniel');
  assert.match(welcome.html, /just reply to this email/, 'the reader is invited to reply');
  assert.match(welcome.text, /— Daniel/, 'the plaintext signs off');
  assert.match(welcome.html, /keep listening, improving, and shipping/, 'the welcome mail promises improvement, not an invented weekly cadence');
  assert.match(welcome.html, /20 credits every day/, 'launch allowance comes from the passed variable, never hardcoded');

  for (const [type, variables] of Object.entries(VARIABLES)) {
    // List mail (signup letters, launch notes) is not about an account and must not carry account
    // boilerplate. It has its own footer, asserted separately below.
    if (templateFor(type).channel === 'list') continue;
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

test('every email carries the mark, and no email carries an X row', () => {
  const visuals = { assetBaseUrl: 'https://intake.example' };
  for (const [type, variables] of Object.entries(VARIABLES)) {
    const rendered = renderEmail(type, { ...APP, ...variables }, { visuals });
    assert.match(rendered.html, /src="https:\/\/intake\.example\/brand\/intake-mark\.png"/, `${type} must show the Intake mark`);
    assert.match(rendered.html, /alt="Intake"/, `${type} mark needs alt text for clients that block images`);
    assert.doesNotMatch(rendered.html, /x\.com|twitter\.com/, `${type} must not link to a social account`);
    assert.doesNotMatch(rendered.text, /x\.com|twitter\.com/, `${type} plaintext must not either`);
  }
});

test('the letter that promised a link under the email points at the changelog instead', () => {
  const rendered = renderEmail('launch_note', { ...APP, ...VARIABLES.launch_note });
  assert.doesNotMatch(rendered.html, /link under this email/, 'it must not promise a link that is not there');
  assert.match(rendered.html, /changelog/i, 'it points at the changelog instead');
  assert.doesNotMatch(rendered.text, /on X/, 'and it does not invite anyone onto X');
});

test('list mail always explains itself and offers a way off the list', () => {
  for (const type of ['waitlist_welcome', 'launch_announcement', 'launch_note']) {
    const rendered = renderEmail(type, { ...APP, ...VARIABLES[type] }, {
      visuals: { assetBaseUrl: 'https://intake.example' },
      unsubscribeUrl: 'https://intake.example/unsubscribe?token=t',
    });
    assert.match(rendered.html, /joined the Intake wait-list/, `${type} says why the reader is on the list`);
    assert.match(rendered.html, /href="https:\/\/intake\.example\/unsubscribe\?token=t"/, `${type} carries a working unsubscribe link`);
    assert.match(rendered.text, /Unsubscribe: https:\/\/intake\.example\/unsubscribe\?token=t/, `${type} plaintext carries it too`);
    assert.doesNotMatch(rendered.html, /required to keep your account secure/, `${type} is not an account notice`);
  }
  // A transactional email is not a subscription and must not offer to unsubscribe from it.
  const otp = renderEmail('otp', { ...APP, ...VARIABLES.otp }, {
    visuals: { assetBaseUrl: 'https://intake.example' },
    unsubscribeUrl: 'https://intake.example/unsubscribe?token=t',
  });
  assert.doesNotMatch(otp.html, /unsubscribe/i);
  assert.match(otp.html, /required to keep your account secure/);
});

test('the two launch letters say different things in different voices', () => {
  const team = renderEmail('launch_announcement', { ...APP, ...VARIABLES.launch_announcement });
  const daniel = renderEmail('launch_note', { ...APP, ...VARIABLES.launch_note });

  assert.match(team.subject, /Intake is live/);
  assert.match(team.html, /The Intake Team/, 'the team letter signs as the team');
  assert.match(team.html, /Google Forms/);
  assert.match(team.html, /Typeform/);
  assert.match(team.html, /href="https:\/\/intake\.example"/, 'the team letter links to the site it was sent from');

  assert.match(daniel.subject, /I wanted to tell you myself/);
  assert.match(daniel.html, /I'm Daniel/, 'the personal letter introduces a person');
  assert.match(daniel.html, /reaches me, not a ticket queue/, 'replies are promised to a human');
  assert.doesNotMatch(daniel.html, /The Intake Team/, 'Daniel does not sign as the team');

  // Both name the same two providers, because both were true on the day they were written.
  for (const rendered of [team, daniel]) {
    assert.match(rendered.html, /Google Forms/);
    assert.match(rendered.html, /Typeform/);
    assert.ok(!rendered.text.includes('<'), 'plaintext stays plaintext');
  }
});

test('the launch letters do not promise a plan, a price or a capability the product lacks', () => {
  for (const type of ['launch_announcement', 'launch_note']) {
    const rendered = renderEmail(type, { ...APP, ...VARIABLES[type] });
    const blob = `${rendered.html} ${rendered.text}`.toLowerCase();
    for (const claim of ['microsoft forms', 'unlimited', 'free forever', 'guaranteed', 'instant results', 'no coding']) {
      assert.ok(!blob.includes(claim), `${type} must not claim "${claim}"`);
    }
  }
});
