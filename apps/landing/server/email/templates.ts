import type { EmailType } from './types';

/**
 * Centralized email templates.
 *
 * Design intent: the same product Intake is on the web — warm paper, near-black ink, one restrained
 * orange accent, a serif for the human voice and a mono face for machine values like a code. Every
 * email renders to both HTML and plaintext from one definition, and no template is ever assembled
 * inline in a route handler.
 *
 * Email-client rules observed here: tables for structure, inline styles only (no <style> reliance),
 * no flexbox/grid, no CSS variables, no SVG, and a dark-mode block that degrades to the light theme
 * in clients that ignore it.
 */

export interface EmailVariables {
  userName?: string;
  otpCode?: string;
  expiryMinutes?: string | number;
  resetUrl?: string;
  dashboardUrl?: string;
  securityUrl?: string;
  connectionsUrl?: string;
  supportUrl?: string;
  timestamp?: string;
  providerName?: string;
  appName?: string;
  headline?: string;
  detail?: string;
  [key: string]: string | number | undefined;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplate {
  id: EmailType;
  /** Calder template alias. Only used when the deployment opts into dashboard-managed templates. */
  alias: string;
  subject(vars: EmailVariables): string;
  preheader(vars: EmailVariables): string;
  heading(vars: EmailVariables): string;
  body(vars: EmailVariables): string;
  text(vars: EmailVariables): string;
}

// ── Palette (mirrors src/styles/base.css, hard-coded because email clients strip custom properties)
const INK = '#0c0c0b';
const PAPER = '#f4efe6';
const CARD = '#fffdf9';
const LINE = '#ded5c4';
const BODY = '#24231f';
const MUTED = '#6f6a5f';
const ACCENT = '#ff5a1f';
const SERIF = "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif";
const SANS = "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function text_(value: string | number | undefined, fallback = ''): string {
  return value === undefined || value === null || String(value).trim() === '' ? fallback : String(value);
}

function paragraph(content: string, style = ''): string {
  return `<p style="margin:0 0 16px;font:16px/1.62 ${SANS};color:${BODY};${style}">${content}</p>`;
}

function button(href: string, label: string): string {
  const safe = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr><td align="center" bgcolor="${ACCENT}" style="border-radius:2px">
    <a href="${safe}" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${SANS};letter-spacing:.01em;color:#ffffff;text-decoration:none;border-radius:2px">${escapeHtml(label)}</a>
  </td></tr></table>
  <p style="margin:0 0 22px;font:12px/1.5 ${MONO};color:${MUTED};word-break:break-all">${escapeHtml(label === 'Reset my password' ? href : '')}</p>`;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${INK};text-decoration:underline;text-decoration-color:${ACCENT};text-underline-offset:3px">${escapeHtml(label)}</a>`;
}

function detailRow(label: string, value: string): string {
  return `<tr><td style="padding:7px 0;font:11px/1.4 ${MONO};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
  <td style="padding:7px 0 7px 18px;font:15px/1.5 ${SANS};color:${BODY}">${escapeHtml(value)}</td></tr>`;
}

function detailsTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 6px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}">${rows}</table>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:26px 0 20px">
    <div style="padding:20px 18px;background:${INK};border-radius:3px;text-align:center">
      <span style="display:block;font:400 34px/1 ${MONO};letter-spacing:.42em;color:#f1ece2;text-indent:.42em">${escapeHtml(code)}</span>
    </div>
    <div style="margin-top:10px;text-align:center;font:12px/1.4 ${MONO};letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">One-time code</div>
  </div>`;
}

function callout(content: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 6px"><tr><td style="padding:16px 18px;background:${PAPER};border-left:2px solid ${ACCENT};border-radius:0 2px 2px 0;font:14px/1.6 ${SANS};color:${BODY}">${content}</td></tr></table>`;
}

/** The one layout every Intake email shares. */
function layout(preheader: string, heading: string, body: string, footerNote: string): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(heading)}</title>
<!--[if mso]>
<style>body,table,td,a{font-family:Helvetica,Arial,sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-font-smoothing:antialiased">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER}">
<tr><td align="center" style="padding:36px 16px 48px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
    <tr><td style="padding:0 0 18px">
      <span style="display:inline-block;font:500 15px/1 ${SANS};letter-spacing:-.01em;color:${INK}">intake<span style="color:${ACCENT}">.</span></span>
    </td></tr>
    <tr><td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:4px;padding:38px 34px 30px">
      <p style="margin:0 0 20px;font:11px/1 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${MUTED}">Intake</p>
      <h1 style="margin:0 0 20px;font:400 27px/1.24 ${SERIF};letter-spacing:-.015em;color:${INK}">${heading}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:22px 4px 0">
      <p style="margin:0 0 8px;font:13px/1.6 ${SANS};color:${MUTED}">${footerNote}</p>
      <p style="margin:0;font:12px/1.6 ${SANS};color:${MUTED}">You are receiving this because it relates to activity on your Intake account. Transactional notices like this one are required to keep your account secure.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Helpers shared by several templates ────────────────────────────────────────────────────────

function greeting(vars: EmailVariables): string {
  return text_(vars.userName) ? `Hi ${escapeHtml(text_(vars.userName))},` : 'Hi there,';
}

function securityFooter(vars: EmailVariables): string {
  const url = text_(vars.securityUrl);
  return `If this was you, no action is needed. If it was not, secure your account now: ${url ? link(url, 'Review account security') : 'sign in and change your password'}.`;
}

/**
 * Plaintext twin of `securityFooter`. A security notice that only links in its HTML half leaves a
 * plaintext reader told to "act now" with no way to act, so the URL is spelled out instead.
 */
/** Plaintext twin of the provider callout: a disconnection the user did not make needs a live link. */
function connectionRemovedText(vars: EmailVariables): string {
  const url = text_(vars.connectionsUrl);
  return url
    ? `If you did not remove this connection, review it here: ${url}`
    : 'If you did not remove this connection, sign in and review your connections.';
}

function securityFooterText(vars: EmailVariables): string {
  const url = text_(vars.securityUrl);
  return url
    ? `If this was you, no action is needed. If it was not, secure your account now: review account security at ${url}`
    : 'If this was you, no action is needed. If it was not, sign in and change your password immediately.';
}

// ── Templates ──────────────────────────────────────────────────────────────────────────────────

const OTP_PURPOSE: Record<string, string> = {
  verify_email: 'verify your email address',
  email_change: 'confirm your new email address',
  sign_in: 'finish signing in',
};

const otp: EmailTemplate = {
  id: 'otp',
  alias: 'intake-otp',
  subject: vars => `${text_(vars.otpCode)} is your Intake verification code`,
  preheader: vars => `Your Intake code is ${text_(vars.otpCode)}. It expires in ${text_(vars.expiryMinutes, '10')} minutes.`,
  heading: () => 'Your verification code',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Use the code below to ${escapeHtml(OTP_PURPOSE[text_(vars.purpose ?? 'verify_email')] ?? OTP_PURPOSE.verify_email!)}. It expires in <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.expiryMinutes, '10'))} minutes</strong>.`),
    codeBlock(text_(vars.otpCode)),
    paragraph('Intake will never ask you for this code. Nobody from Intake will call or message you to request it.', `font-size:14px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Use this code to ${OTP_PURPOSE[text_(vars.purpose ?? 'verify_email')] ?? OTP_PURPOSE.verify_email!}:`,
    '',
    `  ${text_(vars.otpCode)}`,
    '',
    `It expires in ${text_(vars.expiryMinutes, '10')} minutes.`,
    '',
    'Intake will never ask you for this code. If you did not request it, you can safely ignore this email.',
  ].join('\n'),
};

const passwordReset: EmailTemplate = {
  id: 'password_reset',
  alias: 'intake-password-reset',
  subject: () => 'Reset your Intake password',
  preheader: vars => `A password reset was requested for your Intake account. This link expires in ${text_(vars.expiryMinutes, '60')} minutes.`,
  heading: () => 'Reset your password',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Someone asked to reset the password for this Intake account. Use the button below to choose a new one.'),
    button(text_(vars.resetUrl), 'Reset my password'),
    paragraph(`This link expires in <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.expiryMinutes, '60'))} minutes</strong> and can only be used once. Asking for a new link makes this one stop working.`, `font-size:14px;color:${MUTED}`),
    callout('If you did not request a password reset, ignore this email. Your password stays exactly as it is.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Someone asked to reset the password for this Intake account. Open this link to choose a new one:',
    '',
    text_(vars.resetUrl),
    '',
    `This link expires in ${text_(vars.expiryMinutes, '60')} minutes and can only be used once.`,
    '',
    'If you did not request a password reset, ignore this email. Your password stays exactly as it is.',
  ].join('\n'),
};

const welcome: EmailTemplate = {
  id: 'welcome',
  alias: 'intake-welcome',
  subject: () => 'Your Intake account is ready',
  preheader: () => 'Describe the form you need, review the questions, and Intake builds it in your own Google account.',
  heading: () => 'Your account is ready.',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Intake turns a plain-English description into a real Google Form. You see every question before anything is created, change what does not fit, and confirm when it is ready. Editing works the same way: point Intake at a form you already have and describe the change.'),
    paragraph('Three things worth knowing before you start:'),
    `<ol style="margin:0 0 22px;padding-left:20px;font:16px/1.62 ${SANS};color:${BODY}">
      <li style="margin-bottom:8px">Nothing is created until you confirm it.</li>
      <li style="margin-bottom:8px">Connecting Google Forms is a separate authorization from signing in.</li>
      <li>Daily credits refresh at 00:00 UTC and do not roll over.</li>
    </ol>`,
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    paragraph(`If anything looks off, reply to this email or read the ${link(text_(vars.supportUrl) || 'https://intake.example.com', 'help guide')}.`, `font-size:14px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Intake turns a plain-English description into a real Google Form. You see every question before anything is created, change what does not fit, and confirm when it is ready. Editing works the same way: point Intake at a form you already have and describe the change.',
    '',
    'Three things worth knowing before you start:',
    '  1. Nothing is created until you confirm it.',
    '  2. Connecting Google Forms is a separate authorization from signing in.',
    '  3. Daily credits refresh at 00:00 UTC and do not roll over.',
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
    '',
    'If anything looks off, just reply to this email.',
  ].join('\n'),
};

const securityPasswordChanged: EmailTemplate = {
  id: 'security_password_changed',
  alias: 'intake-security-password-changed',
  subject: () => 'Your Intake password was changed',
  preheader: () => 'If you made this change, no action is needed. If you did not, secure your account now.',
  heading: () => 'Your password was changed',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('The password for your Intake account was changed just now. Other signed-in sessions were signed out.'),
    detailsTable(detailRow('When', text_(vars.timestamp))),
    callout(securityFooter(vars)),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'The password for your Intake account was changed just now. Other signed-in sessions were signed out.',
    '',
    `When: ${text_(vars.timestamp)}`,
    '',
    securityFooterText(vars),
  ].join('\n'),
};

const securityEmailChanged: EmailTemplate = {
  id: 'security_email_changed',
  alias: 'intake-security-email-changed',
  subject: vars => `Your Intake email is now ${text_(vars.newEmail)}`,
  preheader: () => 'If you made this change, no action is needed. If you did not, secure your account now.',
  heading: () => 'Your account email changed',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('The email address on your Intake account was changed. Future sign-ins use the new address.'),
    detailsTable([
      detailRow('New email', text_(vars.newEmail)),
      detailRow('Previous email', text_(vars.previousEmail)),
      detailRow('When', text_(vars.timestamp)),
    ].join('')),
    callout(securityFooter(vars)),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'The email address on your Intake account was changed. Future sign-ins use the new address.',
    '',
    `New email: ${text_(vars.newEmail)}`,
    `Previous email: ${text_(vars.previousEmail)}`,
    `When: ${text_(vars.timestamp)}`,
    '',
    securityFooterText(vars),
  ].join('\n'),
};

const securityNewSignIn: EmailTemplate = {
  id: 'security_new_sign_in',
  alias: 'intake-security-new-sign-in',
  subject: () => 'New sign-in to your Intake account',
  preheader: () => 'If this was you, no action is needed. If it was not, secure your account now.',
  heading: () => 'A new sign-in to Intake',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Your Intake account was signed in to from a browser or device we have not seen on this account before.'),
    detailsTable([
      detailRow('When', text_(vars.timestamp)),
      detailRow('Method', text_(vars.method)),
    ].join('')),
    callout(securityFooter(vars)),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Your Intake account was signed in to from a browser or device we have not seen on this account before.',
    '',
    `When: ${text_(vars.timestamp)}`,
    `Method: ${text_(vars.method)}`,
    '',
    securityFooterText(vars),
  ].join('\n'),
};

const securityGoogleConnected: EmailTemplate = {
  id: 'security_google_connected',
  alias: 'intake-security-google-connected',
  subject: () => 'Google sign-in was linked to your Intake account',
  preheader: () => 'You can now sign in with Google. This does not connect Google Forms.',
  heading: () => 'Google sign-in is linked',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Google sign-in is now linked to your Intake account. You can use it instead of your password next time.'),
    detailsTable(detailRow('When', text_(vars.timestamp))),
    paragraph('This is authentication only. It does not give Intake access to your Google Forms; connecting forms is a separate authorization you control on the Connections page.', `font-size:14px;color:${MUTED}`),
    callout(securityFooter(vars)),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Google sign-in is now linked to your Intake account. You can use it instead of your password next time.',
    '',
    `When: ${text_(vars.timestamp)}`,
    '',
    'This is authentication only. It does not give Intake access to your Google Forms.',
    '',
    securityFooterText(vars),
  ].join('\n'),
};

const securityGoogleDisconnected: EmailTemplate = {
  id: 'security_google_disconnected',
  alias: 'intake-security-google-disconnected',
  subject: () => 'Google sign-in was removed from your Intake account',
  preheader: () => 'Google sign-in is no longer linked. Your password and your forms connection are unchanged.',
  heading: () => 'Google sign-in was removed',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Google sign-in is no longer linked to your Intake account. Your password, your data and any Google Forms connection are untouched.'),
    detailsTable(detailRow('When', text_(vars.timestamp))),
    callout(securityFooter(vars)),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Google sign-in is no longer linked to your Intake account. Your password, your data and any Google Forms connection are untouched.',
    '',
    `When: ${text_(vars.timestamp)}`,
    '',
    securityFooterText(vars),
  ].join('\n'),
};

const providerConnectionAdded: EmailTemplate = {
  id: 'provider_connection_added',
  alias: 'intake-provider-connection-added',
  subject: vars => `${text_(vars.providerName)} was connected to Intake`,
  preheader: vars => `Intake can now create and edit forms in this ${text_(vars.providerName)} account when you confirm a request.`,
  heading: vars => `${escapeHtml(text_(vars.providerName))} connected`,
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your ${escapeHtml(text_(vars.providerName))} account is now connected to Intake. Intake can create and edit forms in it, but only when you review a proposal and confirm it yourself.`),
    detailsTable([
      detailRow('Account', text_(vars.accountLabel)),
      detailRow('When', text_(vars.timestamp)),
    ].join('')),
    callout(`If you do not recognise this, disconnect it on the ${link(text_(vars.connectionsUrl), 'Connections page')} and change your password.`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Your ${text_(vars.providerName)} account is now connected to Intake. Intake can create and edit forms in it, but only when you review a proposal and confirm it yourself.`,
    '',
    `Account: ${text_(vars.accountLabel)}`,
    `When: ${text_(vars.timestamp)}`,
    '',
    `If you do not recognise this, disconnect it here: ${text_(vars.connectionsUrl)}`,
  ].join('\n'),
};

const providerConnectionRemoved: EmailTemplate = {
  id: 'provider_connection_removed',
  alias: 'intake-provider-connection-removed',
  subject: vars => `${text_(vars.providerName)} was disconnected from Intake`,
  preheader: vars => `Intake can no longer create or edit forms in this ${text_(vars.providerName)} account.`,
  heading: vars => `${escapeHtml(text_(vars.providerName))} disconnected`,
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your ${escapeHtml(text_(vars.providerName))} account is no longer connected to Intake. Intake cannot create or edit forms in it until you connect again. Forms already created are untouched.`),
    detailsTable([
      detailRow('Account', text_(vars.accountLabel)),
      detailRow('When', text_(vars.timestamp)),
    ].join('')),
    callout(`If you did not remove this connection, review your ${link(text_(vars.connectionsUrl), 'Connections page')} and secure your account.`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Your ${text_(vars.providerName)} account is no longer connected to Intake. Intake cannot create or edit forms in it until you connect again. Forms already created are untouched.`,
    '',
    `Account: ${text_(vars.accountLabel)}`,
    `When: ${text_(vars.timestamp)}`,
    '',
    connectionRemovedText(vars),
  ].join('\n'),
};

const creditsLow: EmailTemplate = {
  id: 'credits_low',
  alias: 'intake-credits-low',
  subject: () => 'You are close to today’s Intake credit limit',
  preheader: vars => `${text_(vars.remaining)} credits left today. Daily credits refresh at 00:00 UTC.`,
  heading: () => 'Running low on credits',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`You have <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.remaining))} credits</strong> left today. Intake needs credits to interpret a request; reviewing and confirming a proposal costs nothing extra.`),
    detailsTable([
      detailRow('Remaining today', text_(vars.remaining)),
      detailRow('Refreshes', text_(vars.resetAt)),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    callout('Interpreting a request is what uses credits. Nothing is charged for a clarification, an unsupported request, or a proposal you decide not to apply.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `You have ${text_(vars.remaining)} credits left today. Intake needs credits to interpret a request; reviewing and confirming a proposal costs nothing extra.`,
    '',
    `Remaining today: ${text_(vars.remaining)}`,
    `Refreshes: ${text_(vars.resetAt)}`,
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
  ].join('\n'),
};

// ── Billing templates ──────────────────────────────────────────────────────────────────────────

const billingSubscriptionStarted: EmailTemplate = {
  id: 'billing_subscription_started',
  alias: 'intake-billing-subscription-started',
  subject: () => 'Your Intake Pro subscription is active',
  preheader: vars => `Your Pro subscription is active with ${text_(vars.subscriptionCredits, '1,000')} credits this period.`,
  heading: () => 'Welcome to Pro',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your Intake Pro subscription is now active. You have <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.subscriptionCredits, '1,000'))} credits</strong> for this billing period, plus your ${escapeHtml(text_(vars.dailyCredits, '10'))} daily credits.`),
    detailsTable([
      detailRow('Plan', text_(vars.planLabel, 'Pro')),
      detailRow('Billing', text_(vars.interval, 'monthly')),
      detailRow('Amount', text_(vars.amount, '$7.99')),
      detailRow('Period', `${text_(vars.periodStart)} — ${text_(vars.periodEnd)}`),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    paragraph('Pro credits refresh each billing period. Daily credits renew at 00:00 UTC. You can see your balance anytime on the billing page.', `font-size:14px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Your Intake Pro subscription is now active. You have ${text_(vars.subscriptionCredits, '1,000')} credits for this billing period, plus your ${text_(vars.dailyCredits, '10')} daily credits.`,
    '',
    `Plan: ${text_(vars.planLabel, 'Pro')}`,
    `Billing: ${text_(vars.interval, 'monthly')}`,
    `Amount: ${text_(vars.amount, '$7.99')}`,
    `Period: ${text_(vars.periodStart)} — ${text_(vars.periodEnd)}`,
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
    '',
    'Pro credits refresh each billing period. Daily credits renew at 00:00 UTC.',
  ].join('\n'),
};

const billingSubscriptionRenewed: EmailTemplate = {
  id: 'billing_subscription_renewed',
  alias: 'intake-billing-subscription-renewed',
  subject: () => 'Your Intake Pro subscription has renewed',
  preheader: vars => `Your Pro subscription renewed for ${text_(vars.amount)}. New credits are available.`,
  heading: () => 'Subscription renewed',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your Intake Pro subscription has renewed successfully. Your credits have been refreshed for the new billing period.`),
    detailsTable([
      detailRow('Amount', text_(vars.amount)),
      detailRow('New period', `${text_(vars.periodStart)} — ${text_(vars.periodEnd)}`),
      detailRow('Credits', text_(vars.subscriptionCredits, '1,000')),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Your Intake Pro subscription has renewed successfully. Your credits have been refreshed.',
    '',
    `Amount: ${text_(vars.amount)}`,
    `New period: ${text_(vars.periodStart)} — ${text_(vars.periodEnd)}`,
    `Credits: ${text_(vars.subscriptionCredits, '1,000')}`,
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
  ].join('\n'),
};

const billingSubscriptionCanceled: EmailTemplate = {
  id: 'billing_subscription_canceled',
  alias: 'intake-billing-subscription-canceled',
  subject: () => 'Your Intake Pro subscription has been canceled',
  preheader: () => 'Your Pro subscription has been canceled. You have been returned to the Free plan.',
  heading: () => 'Subscription canceled',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Your Intake Pro subscription has been canceled. You have been returned to the Free plan.'),
    paragraph('Your previously created forms are unaffected. You retain your Free plan daily credits.'),
    detailsTable([
      detailRow('Canceled on', text_(vars.canceledAt)),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    callout('You can resubscribe to Pro anytime from your billing page. Everything you have built on Intake comes with you.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Your Intake Pro subscription has been canceled. You have been returned to the Free plan.',
    '',
    'Your previously created forms are unaffected. You retain your Free plan daily credits.',
    '',
    `Canceled on: ${text_(vars.canceledAt)}`,
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
    '',
    'You can resubscribe to Pro anytime from your billing page.',
  ].join('\n'),
};

const billingSubscriptionEnding: EmailTemplate = {
  id: 'billing_subscription_ending',
  alias: 'intake-billing-subscription-ending',
  subject: () => 'Your Intake Pro subscription is ending soon',
  preheader: vars => `Your Pro access continues until ${text_(vars.periodEnd)}. After that, your account returns to Free.`,
  heading: () => 'Your subscription is ending',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`You canceled your Intake Pro subscription. Your Pro access continues until <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.periodEnd))}</strong>, after which your account returns to the Free plan.`),
    paragraph('No further charges will be made. Your previously created forms are unaffected.'),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    callout('If you change your mind, you can resubscribe before the period ends to keep your Pro benefits.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `You canceled your Intake Pro subscription. Your Pro access continues until ${text_(vars.periodEnd)}, after which your account returns to the Free plan.`,
    '',
    'No further charges will be made. Your previously created forms are unaffected.',
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
    '',
    'If you change your mind, you can resubscribe before the period ends.',
  ].join('\n'),
};

const billingSubscriptionEnded: EmailTemplate = {
  id: 'billing_subscription_ended',
  alias: 'intake-billing-subscription-ended',
  subject: () => 'Your Intake Pro subscription has ended',
  preheader: () => 'Your Pro subscription period has ended. Your account is now on the Free plan.',
  heading: () => 'Pro access has ended',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('Your Intake Pro subscription period has ended. Your account is now on the Free plan with daily credits.'),
    paragraph('Your previously created forms are unaffected.'),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    callout('You can resubscribe to Pro anytime from your billing page.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'Your Intake Pro subscription period has ended. Your account is now on the Free plan.',
    '',
    'Your previously created forms are unaffected.',
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
    '',
    'You can resubscribe to Pro anytime.',
  ].join('\n'),
};

const billingPaymentSuccess: EmailTemplate = {
  id: 'billing_payment_success',
  alias: 'intake-billing-payment-success',
  subject: vars => `Payment received: ${text_(vars.amount)}`,
  preheader: vars => `Intake received your payment of ${text_(vars.amount)} for ${text_(vars.description)}.`,
  heading: () => 'Payment received',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Intake has received your payment. Thank you.`),
    detailsTable([
      detailRow('Amount', text_(vars.amount)),
      detailRow('Description', text_(vars.description)),
      detailRow('Date', text_(vars.timestamp)),
      detailRow('Reference', text_(vars.referenceId)),
    ].join('')),
    button(text_(vars.dashboardUrl), 'View billing history'),
    paragraph('This is your receipt. No further action is needed.', `font-size:14px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Intake has received your payment. Thank you.`,
    '',
    `Amount: ${text_(vars.amount)}`,
    `Description: ${text_(vars.description)}`,
    `Date: ${text_(vars.timestamp)}`,
    `Reference: ${text_(vars.referenceId)}`,
    '',
    `View billing history: ${text_(vars.dashboardUrl)}`,
    '',
    'This is your receipt. No further action is needed.',
  ].join('\n'),
};

const billingPaymentFailed: EmailTemplate = {
  id: 'billing_payment_failed',
  alias: 'intake-billing-payment-failed',
  subject: () => 'Payment failed — action required',
  preheader: () => 'A payment for your Intake subscription or credit pack could not be processed.',
  heading: () => 'Payment failed',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph('A payment for your Intake account could not be processed. This may affect your subscription or credit availability.'),
    detailsTable([
      detailRow('Description', text_(vars.description, 'Intake billing')),
      detailRow('Date', text_(vars.timestamp)),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Review your billing'),
    callout('Please update your payment method or contact support if this was unexpected. Your existing forms are not affected.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    'A payment for your Intake account could not be processed.',
    '',
    `Description: ${text_(vars.description, 'Intake billing')}`,
    `Date: ${text_(vars.timestamp)}`,
    '',
    `Review your billing: ${text_(vars.dashboardUrl)}`,
    '',
    'Please update your payment method or contact support if this was unexpected.',
  ].join('\n'),
};

const billingCreditPackPurchased: EmailTemplate = {
  id: 'billing_credit_pack_purchased',
  alias: 'intake-billing-credit-pack-purchased',
  subject: vars => `${text_(vars.credits)} credits added to your Intake account`,
  preheader: vars => `${text_(vars.credits)} credits from your ${text_(vars.packLabel)} pack are now available.`,
  heading: vars => `${escapeHtml(text_(vars.credits))} credits added`,
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.packLabel))}</strong> credit pack has been applied. <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.credits))} credits</strong> are now available in your account.`),
    detailsTable([
      detailRow('Pack', text_(vars.packLabel)),
      detailRow('Credits', text_(vars.credits)),
      detailRow('Amount', text_(vars.amount)),
      detailRow('Date', text_(vars.timestamp)),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Open your workspace'),
    paragraph('Purchased credits are used after your daily and subscription credits. They do not expire.', `font-size:14px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Your ${text_(vars.packLabel)} credit pack has been applied. ${text_(vars.credits)} credits are now available.`,
    '',
    `Pack: ${text_(vars.packLabel)}`,
    `Credits: ${text_(vars.credits)}`,
    `Amount: ${text_(vars.amount)}`,
    `Date: ${text_(vars.timestamp)}`,
    '',
    `Open your workspace: ${text_(vars.dashboardUrl)}`,
    '',
    'Purchased credits are used after your daily and subscription credits. They do not expire.',
  ].join('\n'),
};

const billingRenewalReminder: EmailTemplate = {
  id: 'billing_renewal_reminder',
  alias: 'intake-billing-renewal-reminder',
  subject: vars => `Your Intake Pro subscription renews ${text_(vars.renewalDate)}`,
  preheader: vars => `Your Pro subscription will renew on ${text_(vars.renewalDate)} for ${text_(vars.amount)}.`,
  heading: () => 'Upcoming renewal',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your Intake Pro subscription will renew on <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.renewalDate))}</strong>. Your payment method will be charged <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.amount))}</strong>.`),
    detailsTable([
      detailRow('Renewal date', text_(vars.renewalDate)),
      detailRow('Amount', text_(vars.amount)),
      detailRow('Plan', text_(vars.planLabel, 'Pro')),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Manage subscription'),
    paragraph('If you do not wish to continue, you can cancel before the renewal date from your billing page.', `font-size:14px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Your Intake Pro subscription will renew on ${text_(vars.renewalDate)} for ${text_(vars.amount)}.`,
    '',
    `Renewal date: ${text_(vars.renewalDate)}`,
    `Amount: ${text_(vars.amount)}`,
    `Plan: ${text_(vars.planLabel, 'Pro')}`,
    '',
    `Manage subscription: ${text_(vars.dashboardUrl)}`,
    '',
    'If you do not wish to continue, you can cancel before the renewal date.',
  ].join('\n'),
};

export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  otp,
  passwordReset,
  welcome,
  securityPasswordChanged,
  securityEmailChanged,
  securityNewSignIn,
  securityGoogleConnected,
  securityGoogleDisconnected,
  providerConnectionAdded,
  providerConnectionRemoved,
  creditsLow,
  billingSubscriptionStarted,
  billingSubscriptionRenewed,
  billingSubscriptionCanceled,
  billingSubscriptionEnding,
  billingSubscriptionEnded,
  billingPaymentSuccess,
  billingPaymentFailed,
  billingCreditPackPurchased,
  billingRenewalReminder,
];

const BY_ID = new Map<EmailType, EmailTemplate>(EMAIL_TEMPLATES.map(template => [template.id, template]));

export function templateFor(type: EmailType): EmailTemplate {
  const template = BY_ID.get(type);
  if (!template) throw new Error(`Unknown email template: ${type}`);
  return template;
}

/** Renders one email. Pure: given the same variables it always produces the same bytes. */
export function renderEmail(type: EmailType, variables: EmailVariables): RenderedEmail {
  const template = templateFor(type);
  const subject = template.subject(variables);
  const heading = template.heading(variables);
  const footer = 'Intake · Google Forms from a sentence.';
  return {
    subject,
    html: layout(template.preheader(variables), heading, template.body(variables), footer),
    text: `${subject}\n\n${template.text(variables)}\n\n—\nIntake · Google Forms from a sentence.`,
  };
}
