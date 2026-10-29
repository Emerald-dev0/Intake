import type { EmailType } from './types';
import { WAITLIST_WELCOME_TEXT } from './waitlist-welcome';
import {
  C, DEFAULT_VISUALS, shell, button as designButton, paragraph as designParagraph, statement as designStatement,
  chips, tickList, signature, rule, muted, type FooterKind, type VisualOptions,
} from './design';

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
  /** Free-plan daily allowance, always passed explicitly by the notifier — never hardcoded. */
  dailyCredits?: string | number;
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
  /** `list` mail reaches people who subscribed; it carries an unsubscribe line and no account boilerplate. */
  channel?: FooterKind;
  /** Calder template alias. Only used when the deployment opts into dashboard-managed templates. */
  alias: string;
  subject(vars: EmailVariables): string;
  preheader(vars: EmailVariables): string;
  /** Monospace label above the headline. Optional; list letters use it instead of a headline. */
  eyebrow?(vars: EmailVariables): string;
  heading(vars: EmailVariables): string;
  body(vars: EmailVariables): string;
  text(vars: EmailVariables): string;
}

// The human support address, shown as plain text in every footer. It is intentionally never a
// `mailto:` link: the test suite forbids provider-domain hrefs, and reply-to already answers.
export const SUPPORT_EMAIL = 'support@intake.calder.click';

// ── Palette (mirrors src/styles/base.css, hard-coded because email clients strip custom properties)
const INK = '#0c0c0b';
const PAPER = '#f4efe6';
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
  return designParagraph(content, style);
}

function button(href: string, label: string): string {
  // A reset link is the one action that must survive in a text-only client, so its URL is printed
  // under the button rather than hidden behind it.
  const printed = label === 'Reset my password'
    ? `<p style="margin:0 0 22px;font:12px/1.5 ${MONO};color:${MUTED};word-break:break-all">${escapeHtml(href)}</p>`
    : '';
  return designButton(href, label) + printed;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${INK};text-decoration:underline;text-decoration-color:${ACCENT};text-underline-offset:3px">${escapeHtml(label)}</a>`;
}

/**
 * The first letter of a name, capitalised.
 *
 * A subject line that starts in lower case reads like a typing mistake — "typeform was
 * disconnected from Intake". The name itself is left exactly as the product writes it; only the
 * first letter of the line changes.
 */
function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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

/** Options a caller can thread through that are not per-template copy. */
export interface RenderOptions {
  /** Logo host and X account. Deployments override these; see `server/email/config.ts`. */
  visuals?: VisualOptions;
  /** Per-recipient signed unsubscribe link. List mail should always carry one. */
  unsubscribeUrl?: string;
}

/** Transactional mail: account, security, billing. Carries the account footer, never an unsubscribe. */
function layout(preheaderText: string, headingText: string, body: string, _footerNote: string, options: RenderOptions = {}): string {
  return shell({
    preheaderText,
    headingText,
    body,
    footerKind: 'transactional',
    supportEmail: SUPPORT_EMAIL,
    visuals: options.visuals,
  });
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

// A signup confirmation is a personal letter, not an account-security notification. In particular,
// it must not tell wait-list subscribers that they have an account, a password, or access already.
const waitlistWelcome: EmailTemplate = {
  id: 'waitlist_welcome',
  channel: 'list',
  alias: 'intake-waitlist-welcome',
  subject: () => "You're on the Intake wait-list — a note from Daniel",
  preheader: () => "I'm Daniel, the person building Intake, and I'm glad you're here.",
  eyebrow: () => 'WELCOME',
  heading: () => '',
  body: () => WAITLIST_WELCOME_TEXT.split('\n\n').map(part => paragraph(
    escapeHtml(part).replace(/\n/g, '<br />').replace('https://intake.calder.click', link('https://intake.calder.click', 'https://intake.calder.click')),
  )).join(''),
  text: () => WAITLIST_WELCOME_TEXT,
};

/**
 * List mail: a letter to people who subscribed. Same card as everything else, different footer — it
 * explains why they are on the list and gives them a working way off it.
 */
function letterLayout(preheaderText: string, body: string, options: RenderOptions = {}, kind: { eyebrowText?: string; headingText?: string; reason?: string } = {}): string {
  return shell({
    preheaderText,
    eyebrowText: kind.eyebrowText,
    headingText: kind.headingText,
    body,
    footerKind: 'list',
    footerReason: kind.reason,
    unsubscribeUrl: options.unsubscribeUrl,
    supportEmail: SUPPORT_EMAIL,
    visuals: options.visuals,
  });
}


// ── Launch mail ────────────────────────────────────────────────────────────────────────────────
//
// Two letters, sent once, to people who asked to hear from Intake before it existed. They are the
// only emails in the catalogue written to be read by someone who is not yet a customer, so the rules
// are different from the rest: no account language, no security boilerplate, no credits, and a
// working unsubscribe in the footer. Everything either letter claims must be true of the product on
// the day it is sent — which is why the providers are named from the same list the app offers, not
// from marketing ambition.

const LAUNCH_SITE = 'https://intake.calder.click';

function launchUrl(vars: EmailVariables): string {
  return escapeHtml(text_(vars.marketingUrl, LAUNCH_SITE));
}

const launchAnnouncement: EmailTemplate = {
  id: 'launch_announcement',
  channel: 'list',
  alias: 'intake-launch-announcement',
  subject: () => 'Intake is live — a form from a sentence',
  preheader: () => 'Describe the form you need. Intake builds it in your own Google Forms or Typeform account.',
  eyebrow: () => "WE'RE LIVE",
  heading: () => 'Intake is live.',
  body: vars => {
    const site = launchUrl(vars);
    return [
      paragraph('Hey there,'),
      paragraph(`You joined the Intake wait-list a while ago, and I wanted you to hear this from us first: <strong style="color:${C.ink}">we are officially live.</strong>`, `font-size:17px;line-height:1.6;color:${C.ink}`),
      designStatement('Describe the form you need. It exists.'),
      paragraph('Intake turns a sentence into a real form — the questions, the wording, the order — and creates it in your own account, ready to send. No blank builder, no assembling twenty fields by hand at midnight.'),
      paragraph('It works today with <strong style="color:' + C.ink + '">Google Forms</strong> and <strong style="color:' + C.ink + '">Typeform</strong>. You keep the form, the responses and the account; Intake never hosts your data.'),
      chips(['Google Forms', 'Typeform']),
      paragraph('It is built for people who need a form, not a form tool:'),
      tickList([
        'A final-year student building a research questionnaire',
        'A researcher collecting data that has to be collected properly',
        'A founder asking for feedback and actually reading it',
        'Anyone organising an event who needs registrations by Friday',
      ]),
      button(site, 'Try Intake →'),
      muted(`Or paste this into your browser: <a href="${site}" style="color:${C.muted}">${escapeHtml(text_(vars.marketingUrl, LAUNCH_SITE))}</a>`),
      rule(),
      paragraph('We are still early, and still building. If something is confusing, if a form comes out wrong, or if there is something you wish Intake did — reply to this email and tell us. A person reads every reply, and more of what comes next will start with a message like yours.'),
      paragraph('Thanks for being here before we launched.'),
      signature('The Intake Team', 'Intake'),
    ].join('');
  },
  text: vars => [
    'Hey there,',
    `You joined the Intake wait-list a while ago, and I wanted you to hear this from us first: we are officially live.`,
    'Describe the form you need. It exists.',
    'Intake turns a sentence into a real form — the questions, the wording, the order — and creates it in your own account, ready to send. No blank builder, no assembling twenty fields by hand at midnight.',
    'It works today with Google Forms and Typeform. You keep the form, the responses and the account; Intake never hosts your data.',
    'It is built for people who need a form, not a form tool:',
    '  - A final-year student building a research questionnaire',
    '  - A researcher collecting data that has to be collected properly',
    '  - A founder asking for feedback and actually reading it',
    '  - Anyone organising an event who needs registrations by Friday',
    `Try Intake: ${text_(vars.marketingUrl, LAUNCH_SITE)}`,
    'We are still early, and still building. If something is confusing, if a form comes out wrong, or if there is something you wish Intake did — reply to this email and tell us.',
    'Thanks for being here before we launched.',
    'The Intake Team',
  ].join('\n\n'),
};

const launchNote: EmailTemplate = {
  id: 'launch_note',
  channel: 'list',
  alias: 'intake-launch-note',
  subject: () => 'Intake is live — and I wanted to tell you myself',
  preheader: () => 'A short note from Daniel, who is building Intake, on the day it went live.',
  eyebrow: () => 'A NOTE FROM DANIEL',
  heading: () => '',
  body: vars => {
    const site = launchUrl(vars);
    return [
      paragraph('Hey there,'),
      paragraph("I'm Daniel — one of the people building Intake."),
      paragraph("You signed up for the wait-list a while back, and I didn't want the launch to pass without writing to you myself."),
      designStatement('We are live. 🚀').replace('margin:26px 0', 'margin:22px 0'),
      paragraph("The idea behind Intake is simple: you shouldn't have to spend an afternoon assembling questions in a builder to get one small form out into the world. You should be able to explain what you need, and have the thing made."),
      paragraph(`That is what Intake does now, with <strong style="color:${C.ink}">Google Forms</strong> and <strong style="color:${C.ink}">Typeform</strong>.`),
      paragraph("If you're finishing a project, collecting research data, organising an event, or building something that needs forms — I'd love for you to try it."),
      button(site, 'Give Intake a try →'),
      paragraph("We're early, and there's a lot I still want to improve. If you try it and something feels confusing, or a form doesn't come out the way you pictured it, tell me. Reply straight to this email — it reaches me, not a ticket queue."),
      rule(),
      paragraph("And if you'd like to follow along as we build — the things that break, the fixes, what's next — the changelog keeps the record, and every release has a page of its own."),
      paragraph('Thank you for signing up before there was anything to see. I hope Intake earns that.'),
      signature('Daniel', 'Building Intake'),
    ].join('');
  },
  text: vars => [
    'Hey there,',
    "I'm Daniel — one of the people building Intake.",
    "You signed up for the wait-list a while back, and I didn't want the launch to pass without writing to you myself.",
    'We are live.',
    "The idea behind Intake is simple: you shouldn't have to spend an afternoon assembling questions in a builder to get one small form out into the world. You should be able to explain what you need, and have the thing made.",
    'That is what Intake does now, with Google Forms and Typeform.',
    "If you're finishing a project, collecting research data, organising an event, or building something that needs forms — I'd love for you to try it.",
    `Give Intake a try: ${text_(vars.marketingUrl, LAUNCH_SITE)}`,
    "We're early, and there's a lot I still want to improve. If you try it and something feels confusing, or a form doesn't come out the way you pictured it, tell me. Reply straight to this email — it reaches me, not a ticket queue.",
    "And if you'd like to follow along as we build — the things that break, the fixes, what's next — the changelog keeps the record, and every release has a page of its own.",
    'Thank you for signing up before there was anything to see. I hope Intake earns that.',
    'Daniel\nBuilding Intake',
  ].join('\n\n'),
};

const welcome: EmailTemplate = {
  id: 'welcome',
  alias: 'intake-welcome',
  subject: vars => `${text_(vars.userName) ? `${text_(vars.userName)}, welcome` : 'Welcome'} to Intake — a note from Daniel`,
  preheader: () => 'Your workspace is ready. Here is how to get started, and how to reach me.',
  heading: () => 'Welcome in.',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph("I'm Daniel, the person building Intake, and I'm really glad you're here."),
    paragraph("Describe the form you need in plain English, review the questions, and confirm when it looks right. Intake creates it in your own Google account. Editing the forms you already have works the same way."),
    text_(vars.dailyCredits) ? paragraph(`Your Free account comes with ${escapeHtml(text_(vars.dailyCredits))} credits every day.`) : '',
    button(text_(vars.dashboardUrl), 'Open Intake'),
    paragraph("And this is just the beginning. We'll keep listening, improving, and shipping things that genuinely make your work easier."),
    paragraph("If something feels confusing, something breaks, or there's something you'd love Intake to help you do, just reply to this email. I'd genuinely love to hear from you."),
    paragraph('Thanks for being here early.'),
    paragraph('— Daniel', `font-family:${SERIF};font-size:17px;color:${INK}`),
    paragraph('Founder &amp; Builder, Intake', `font-size:13px;color:${MUTED}`),
  ].join(''),
  text: vars => [
    text_(vars.userName) ? `Hi ${text_(vars.userName)},` : 'Hi there,',
    "I'm Daniel, the person building Intake, and I'm really glad you're here.",
    'Describe the form you need in plain English, review the questions, and confirm when it looks right. Intake creates it in your own Google account. Editing the forms you already have works the same way.',
    text_(vars.dailyCredits) ? `Your Free account comes with ${text_(vars.dailyCredits)} credits every day.` : '',
    `Open Intake: ${text_(vars.dashboardUrl)}`,
    "And this is just the beginning. We'll keep listening, improving, and shipping things that genuinely make your work easier.",
    "If something feels confusing, something breaks, or there's something you'd love Intake to help you do, just reply to this email. I'd genuinely love to hear from you.",
    'Thanks for being here early.',
    '— Daniel\nFounder & Builder, Intake',
  ].filter(Boolean).join('\n\n'),
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
  subject: vars => `${sentenceCase(text_(vars.providerName))} was connected to Intake`,
  preheader: vars => `Intake can now create and edit forms in this ${text_(vars.providerName)} account when you confirm a request.`,
  heading: vars => `${escapeHtml(sentenceCase(text_(vars.providerName)))} connected`,
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
  subject: vars => `${sentenceCase(text_(vars.providerName))} was disconnected from Intake`,
  preheader: vars => `Intake can no longer create or edit forms in this ${text_(vars.providerName)} account.`,
  heading: vars => `${escapeHtml(sentenceCase(text_(vars.providerName)))} disconnected`,
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


const devAnswersReceived: EmailTemplate = {
  id: 'dev_answers_received',
  alias: 'intake-dev-answers-received',
  subject: vars => `${text_(vars.answerCount)} new ${text_(vars.answerCount) === '1' ? 'answer' : 'answers'} on ${text_(vars.projectName)}`,
  preheader: vars => `${text_(vars.answerCount)} new answers on ${text_(vars.projectName)}.`,
  heading: () => 'Your form has new answers',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your form <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.projectName))}</strong> has <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.answerCount))}</strong> new ${text_(vars.answerCount) === '1' ? 'answer' : 'answers'} waiting.`),
    detailsTable([
      detailRow('Form', text_(vars.formName)),
      detailRow('New answers', text_(vars.answerCount)),
      ...(text_(vars.sinceLast) ? [detailRow('Since the last notice', text_(vars.sinceLast))] : []),
    ].join('')),
    button(text_(vars.dashboardUrl), 'Read the answers'),
    callout('This is your own form, and these are answers to your own form. Nobody else is written to from it.'),
  ].join(''),
  text: vars => [
    greeting(vars),
    '',
    `Your form ${text_(vars.projectName)} has ${text_(vars.answerCount)} new ${text_(vars.answerCount) === '1' ? 'answer' : 'answers'} waiting.`,
    '',
    `Form: ${text_(vars.formName)}`,
    `New answers: ${text_(vars.answerCount)}`,
    ...(text_(vars.sinceLast) ? [`Since the last notice: ${text_(vars.sinceLast)}`] : []),
    '',
    `Read the answers: ${text_(vars.dashboardUrl)}`,
  ].join('\n'),
};

// ── Developer workspace templates ────────────────────────────────────────────────────────────────

// ── Billing templates ──────────────────────────────────────────────────────────────────────────

const billingSubscriptionStarted: EmailTemplate = {
  id: 'billing_subscription_started',
  alias: 'intake-billing-subscription-started',
  subject: () => 'Your Intake Pro subscription is active',
  preheader: vars => `Your Pro subscription is active with ${text_(vars.subscriptionCredits, '1,000')} credits this period.`,
  heading: () => 'Welcome to Pro',
  body: vars => [
    paragraph(greeting(vars)),
    paragraph(`Your Intake Pro subscription is now active. You have <strong style="font-weight:600;color:${INK}">${escapeHtml(text_(vars.subscriptionCredits, '1,000'))} credits</strong> for this billing period, plus your ${escapeHtml(text_(vars.dailyCredits, '20'))} daily credits.`),
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
    `Your Intake Pro subscription is now active. You have ${text_(vars.subscriptionCredits, '1,000')} credits for this billing period, plus your ${text_(vars.dailyCredits, '20')} daily credits.`,
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

/**
 * A message an operator composed in the dashboard.
 *
 * The body is plain text on purpose: it is authored by a person in a textarea, so it is escaped and
 * split into paragraphs rather than trusted as markup. `{{name}}` and friends are substituted by the
 * server before rendering, never by the browser, so nothing about a recipient's identity is decided
 * client-side.
 */
const adminMessage: EmailTemplate = {
  id: 'admin_message',
  alias: 'intake-admin-message',
  subject: vars => text_(vars.adminSubject, 'A note from Intake'),
  preheader: vars => text_(vars.adminPreheader, text_(vars.adminSubject, 'A note from the Intake team.')),
  heading: vars => text_(vars.adminHeading, text_(vars.adminSubject, 'A note from Intake')),
  // No greeting is added here: the operator writes the whole message, and the composer starts them
  // off with "Hi {{name}},". Adding one automatically would either duplicate their salutation or
  // greet a stranger "Hi there," in an email they did not write that way.
  body: vars => {
    const paragraphs = text_(vars.adminBody).split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    const url = text_(vars.dashboardUrl);
    return [
      ...paragraphs.map(part => paragraph(escapeHtml(part).replace(/\n/g, '<br />'))),
      url ? button(url, text_(vars.adminButtonLabel, 'Open Intake')) : '',
    ].join('');
  },
  text: vars => {
    const paragraphs = text_(vars.adminBody).split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    const url = text_(vars.dashboardUrl);
    return [...paragraphs, ...(url ? [`${text_(vars.adminButtonLabel, 'Open Intake')}: ${url}`] : [])].join('\n\n');
  },
};

export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  otp,
  passwordReset,
  welcome,
  waitlistWelcome,
  launchAnnouncement,
  launchNote,
  securityPasswordChanged,
  securityEmailChanged,
  securityNewSignIn,
  securityGoogleConnected,
  securityGoogleDisconnected,
  providerConnectionAdded,
  providerConnectionRemoved,
  creditsLow,
  devAnswersReceived,
  billingSubscriptionStarted,
  billingSubscriptionRenewed,
  billingSubscriptionCanceled,
  billingSubscriptionEnding,
  billingSubscriptionEnded,
  billingPaymentSuccess,
  billingPaymentFailed,
  billingCreditPackPurchased,
  billingRenewalReminder,
  adminMessage,
];

const BY_ID = new Map<EmailType, EmailTemplate>(EMAIL_TEMPLATES.map(template => [template.id, template]));

export function templateFor(type: EmailType): EmailTemplate {
  const template = BY_ID.get(type);
  if (!template) throw new Error(`Unknown email template: ${type}`);
  return template;
}

/** Why a stranger is on this list. Every bulk email says it; an unexplained one is a complaint. */
const LIST_REASON = 'You are receiving this because you joined the Intake wait-list.';

function listTextFooter(unsubscribeUrl: string | undefined): string {
  return [
    '—',
    'Intake · a form from a sentence',
    unsubscribeUrl ? `${LIST_REASON} Unsubscribe: ${unsubscribeUrl}` : LIST_REASON,
  ].join('\n');
}

function transactionalTextFooter(): string {
  return [
    '—',
    'Intake · a form from a sentence',
    `Questions? Just reply, or write to ${SUPPORT_EMAIL} — a human reads everything.`,
  ].join('\n');
}

/** Renders one email. Pure: given the same variables it always produces the same bytes. */
export function renderEmail(type: EmailType, variables: EmailVariables, options: RenderOptions = {}): RenderedEmail {
  const template = templateFor(type);
  const subject = template.subject(variables);
  const heading = template.heading(variables);
  const visuals = options.visuals ?? DEFAULT_VISUALS;
  const unsubscribeUrl = options.unsubscribeUrl ?? (text_(variables.unsubscribeUrl) || undefined);

  if (template.channel === 'list') {
    const html = letterLayout(template.preheader(variables), template.body(variables), { visuals, unsubscribeUrl }, {
      eyebrowText: template.eyebrow?.(variables),
      // A letter that opens with "Hey there," does not need a headline repeating who wrote it.
      headingText: heading || undefined,
      reason: LIST_REASON,
    });
    return { subject, html, text: `${template.text(variables)}\n\n${listTextFooter(unsubscribeUrl)}` };
  }

  return {
    subject,
    html: layout(template.preheader(variables), heading, template.body(variables), '', { visuals }),
    text: `${subject}\n\n${template.text(variables)}\n\n${transactionalTextFooter()}`,
  };
}
