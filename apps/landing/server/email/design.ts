/**
 * The visual system every Intake email is built from.
 *
 * Why this file exists: the first generation of Intake mail was a single white card with a wall of
 * identical paragraphs, no mark, no hierarchy and no way to recognise the sender at a glance. It read
 * like a system notification. These are letters from a product people chose to hear from, so they get
 * a real design: a paper ground, one card, one accent, a serif voice for the human sentence and a
 * monospace label for the machine one.
 *
 * Email-client rules are not negotiable and are observed everywhere below:
 *   - tables for structure, never flex/grid; inline styles only;
 *   - no SVG, because Gmail and Outlook strip it. The mark is a PNG served from our own origin, with
 *     `alt` text that reads correctly when a client blocks images;
 *   - no webfonts, because no client will load them. Fraunces and Geist are named first so the few
 *     clients that have them use them, and Georgia / system sans carry everyone else;
 *   - no CSS variables, because clients strip them; the palette is duplicated from base.css by hand;
 *   - dark mode is declared `light only`: the card is cream by design, and letting a client invert it
 *     would produce dark text on dark paper.
 */

/** Palette mirror of `src/styles/base.css`. Hard-coded because email clients strip custom properties. */
export const C = {
  ink: '#0c0c0b',
  inkSoft: '#24231f',
  muted: '#6f6a5f',
  paper: '#f4efe6',
  card: '#fffdf9',
  line: '#ded5c4',
  lineSoft: '#ece5d8',
  accent: '#ff5a1f',
  accentWash: '#fdf0e7',
} as const;

export const SERIF = "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif";
export const SANS = "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO = "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/**
 * Where the mark is fetched from.
 *
 * Overridable per deployment (see `server/email/config.ts`): the logo must live on a public origin
 * the recipient's client can reach.
 */
export interface VisualOptions {
  /** Origin that serves `/brand/intake-mark.png`. No trailing slash. */
  assetBaseUrl: string;
}

export const DEFAULT_VISUALS: VisualOptions = {
  assetBaseUrl: 'https://intake.calder.click',
};

/** `transactional` gets the account/security footer; `list` gets the wait-list footer and unsubscribe. */
export type FooterKind = 'transactional' | 'list';

const PAD_X = 38;

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Hidden preview text: what the inbox shows next to the subject line. */
export function preheader(text: string): string {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${attr(text)}${'&nbsp;&zwnj;'.repeat(60)}</div>`;
}

/**
 * The mark, plus the wordmark as live text.
 *
 * The wordmark is text rather than part of the image for two reasons: it stays crisp at any zoom, and
 * it still reads as "intake." in the clients that block remote images by default.
 */
export function brandHeader(options: VisualOptions): string {
  const mark = `${options.assetBaseUrl.replace(/\/$/, '')}/brand/intake-mark.png`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
  <td align="left" style="padding:0 0 22px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" valign="middle" style="padding:0 10px 0 0">
        <img src="${attr(mark)}" width="30" height="30" alt="Intake" style="display:block;width:30px;height:30px;border:0;outline:none;text-decoration:none" />
      </td>
      <td valign="middle" style="font:600 17px/1 ${SANS};letter-spacing:-.02em;color:${C.ink}">intake<span style="color:${C.accent}">.</span></td>
    </tr></table>
  </td>
</tr></table>`;
}

/** A monospace label above the headline. One per email, uppercase, wide-tracked. */
export function eyebrow(text: string): string {
  return `<p style="margin:0 0 14px;font:600 10px/1.4 ${MONO};letter-spacing:.2em;text-transform:uppercase;color:${C.accent}">${text}</p>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 22px;font:400 31px/1.2 ${SERIF};letter-spacing:-.02em;color:${C.ink}">${text}</h1>`;
}

/** A serif statement set larger than body text, for the one sentence that carries the news. */
export function statement(text: string): string {
  return `<p class="shell-statement" style="margin:26px 0;font:400 24px/1.35 ${SERIF};letter-spacing:-.015em;color:${C.ink}">${text}</p>`;
}

export function paragraph(content: string, style = ''): string {
  return `<p style="margin:0 0 18px;font:16px/1.68 ${SANS};color:${C.inkSoft};${style}">${content}</p>`;
}

export function lead(content: string): string {
  return paragraph(content, `font-size:17px;line-height:1.6;color:${C.ink}`);
}

export function muted(content: string): string {
  return `<p style="margin:0 0 14px;font:14px/1.6 ${SANS};color:${C.muted}">${content}</p>`;
}

export function rule(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding:12px 0 26px"><div style="height:1px;background:${C.lineSoft};line-height:1px;font-size:0">&nbsp;</div></td></tr></table>`;
}

/**
 * The primary call to action.
 *
 * A padded table cell rather than a styled `<a>`: Outlook renders a padded anchor as an underlined
 * word with no box, and the button is the one element an email cannot afford to lose. Ink on cream,
 * not accent on cream — the accent is for the eyebrow, the mark and links, so the button stays the
 * calmest thing on the page.
 */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr>
  <td align="center" bgcolor="${C.ink}" style="background:${C.ink};border-radius:4px;padding:15px 30px">
    <a href="${attr(href)}" style="display:inline-block;font:600 15px/1.2 ${SANS};letter-spacing:.01em;color:${C.card};text-decoration:none">${label}</a>
  </td></tr></table>`;
}

/** A quiet secondary action: accent text with an arrow, no box. Sits under the button. */
export function textLink(href: string, label: string): string {
  return `<p style="margin:0 0 18px;font:15px/1.6 ${SANS}"><a href="${attr(href)}" style="color:${C.accent};text-decoration:none;font-weight:600">${label}</a></p>`;
}

/** Two or three names in bordered cells, e.g. the providers a launch mail can create forms in. */
export function chips(items: string[]): string {
  const cells = items.map(item => `<td style="padding:0 8px 0 0"><span style="display:inline-block;padding:9px 15px;border:1px solid ${C.line};border-radius:999px;background:${C.card};font:600 13px/1 ${SANS};color:${C.ink}">${item}</span></td>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>${cells}</tr></table>`;
}

/** A short list with accent ticks, for "who this is for" without a bulleted wall. */
export function tickList(items: string[]): string {
  const rows = items.map(item => `<tr>
    <td width="20" valign="top" style="padding:0 0 10px;font:600 15px/1.6 ${SANS};color:${C.accent}">✓</td>
    <td valign="top" style="padding:0 0 10px;font:15px/1.6 ${SANS};color:${C.inkSoft}">${item}</td>
  </tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 22px;width:100%">${rows}</table>`;
}

/** A bordered aside: one fact worth separating from the prose. */
export function callout(content: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 24px"><tr>
  <td style="padding:16px 18px;background:${C.accentWash};border-left:3px solid ${C.accent};border-radius:0 3px 3px 0;font:14px/1.65 ${SANS};color:${C.inkSoft}">${content}</td>
</tr></table>`;
}

/** The human sign-off. Serif name, muted role, no photo needed to feel like a person wrote it. */
export function signature(name: string, role: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 2px"><tr><td>
  <p style="margin:0;font:400 19px/1.3 ${SERIF};color:${C.ink}">${name}</p>
  <p style="margin:4px 0 0;font:13px/1.5 ${SANS};color:${C.muted}">${role}</p>
</td></tr></table>`;
}

export interface FooterOptions {
  kind: FooterKind;
  /** Why the reader is on this list. Required for `list`: an unexplained bulk email is a complaint. */
  reason?: string;
  /** Per-recipient signed unsubscribe link. Without it, list mail falls back to the support address. */
  unsubscribeUrl?: string;
  supportEmail: string;
}

function footer(options: FooterOptions): string {
  if (options.kind === 'transactional') {
    return `<tr><td style="padding:24px 4px 0">
  <p style="margin:0 0 8px;font:13px/1.65 ${SANS};color:${C.muted}">Questions, trouble, or a salty edge case? Just reply to this email, or write to ${options.supportEmail} — a human being reads everything.</p>
  <p style="margin:0;font:12px/1.6 ${SANS};color:${C.muted}">You are receiving this because it relates to activity on your Intake account. Transactional notices like this one are required to keep your account secure.</p>
</td></tr>`;
  }
  const reason = options.reason ?? 'You are receiving this because you joined the Intake wait-list.';
  const out = options.unsubscribeUrl
    ? `<a href="${attr(options.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline">Unsubscribe</a>`
    : `Reply to this email and ask to be removed.`;
  return `<tr><td style="padding:24px 4px 0">
  <p style="margin:0 0 8px;font:13px/1.65 ${SANS};color:${C.muted}">${reason} ${out}.</p>
  <p style="margin:0;font:12px/1.6 ${SANS};color:${C.muted}">Intake · a form from a sentence · <a href="https://intake.calder.click" style="color:${C.muted}">intake.calder.click</a></p>
</td></tr>`;
}

export interface ShellOptions {
  preheaderText: string;
  /** Optional monospace label above the headline. */
  eyebrowText?: string;
  /** Headline. Omit for a letter that opens with the greeting instead. */
  headingText?: string;
  body: string;
  footerKind: FooterKind;
  footerReason?: string;
  unsubscribeUrl?: string;
  supportEmail: string;
  visuals?: VisualOptions;
}

/**
 * The one document shell. Every Intake email is this: paper ground, mark, one card, footer.
 *
 * The card's left and right padding shrink on narrow screens through a media query, but the inline
 * value is what every client that ignores media queries will use, so it is the one that has to look
 * right on its own.
 */
export function shell(options: ShellOptions): string {
  const visuals = options.visuals ?? DEFAULT_VISUALS;
  const title = options.headingText ? attr(options.headingText.replace(/<[^>]+>/g, '')) : 'Intake';
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${title}</title>
<!--[if mso]>
<style>body,table,td,a,p,h1{font-family:Helvetica,Arial,sans-serif !important;}</style>
<![endif]-->
<style>
  @media only screen and (max-width:600px){
    .shell-pad{padding-left:24px !important;padding-right:24px !important}
    .shell-outer{padding:22px 12px 34px !important}
    .shell-h1{font-size:27px !important;line-height:1.22 !important}
    .shell-statement{font-size:21px !important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%">
${preheader(options.preheaderText)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.paper}">
<tr><td align="center" class="shell-outer" style="padding:34px 16px 46px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px">
    <tr><td>${brandHeader(visuals)}</td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:6px;padding:0">
      <div style="height:3px;background:${C.accent};border-radius:6px 6px 0 0;line-height:3px;font-size:0">&nbsp;</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td class="shell-pad" style="padding:34px ${PAD_X}px 30px">
          ${options.eyebrowText ? eyebrow(options.eyebrowText) : ''}
          ${options.headingText ? `<h1 class="shell-h1" style="margin:0 0 22px;font:400 31px/1.2 ${SERIF};letter-spacing:-.02em;color:${C.ink}">${options.headingText}</h1>` : ''}
          ${options.body}
        </td>
      </tr></table>
    </td></tr>
    ${footer({ kind: options.footerKind, reason: options.footerReason, unsubscribeUrl: options.unsubscribeUrl, supportEmail: options.supportEmail })}
  </table>
</td></tr>
</table>
</body>
</html>`;
}
