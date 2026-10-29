/**
 * Renders the launch mail to static HTML so a human can look at it in a browser.
 *
 * This exists because an email template that has only been asserted against is not designed — it is
 * merely consistent. Running this writes `docs/email-preview/`, each message with the inbox row it
 * will actually produce (sender, subject, preview text), and `index.html` to compare them.
 *
 *   npx tsx scripts/preview-emails.ts
 *
 * The output is documentation, not a shipped asset: it is written outside `public/` so it never
 * reaches production, and it is regenerated rather than edited.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderEmail, type EmailVariables } from '../server/email/templates';
import type { EmailType } from '../server/email/types';

const OUT = join(import.meta.dirname, '..', 'docs', 'email-preview');

/**
 * `assetBaseUrl` is `./` only here: the preview frames are served from the same directory as the
 * copied logo, so the mark renders without reaching the public internet. Real mail always gets an
 * absolute origin, because a mail client has no page to resolve a relative path against.
 */
const VISUALS = {
  assetBaseUrl: '.',
};

const SITE = 'https://intake.calder.click';
const UNSUBSCRIBE = 'https://intake.calder.click/api/waitlist/unsubscribe?token=preview-token';

interface Preview {
  file: string;
  type: EmailType;
  from: { name: string; email: string };
  replyTo: string;
  variables: EmailVariables;
  note: string;
}

const PREVIEWS: Preview[] = [
  {
    file: '01-intake-team-launch',
    type: 'launch_announcement',
    from: { name: 'The Intake Team', email: 'hello@intake.calder.click' },
    replyTo: 'hello@intake.calder.click',
    variables: { marketingUrl: SITE },
    note: 'Email 1 — the launch announcement. From the team, not from Daniel, so it can speak for the product.',
  },
  {
    file: '02-daniel-launch-note',
    type: 'launch_note',
    from: { name: 'Daniel from Intake', email: 'daniel@intake.calder.click' },
    replyTo: 'daniel@intake.calder.click',
    variables: { marketingUrl: SITE },
    note: 'Email 2 — the personal note. Replies land with Daniel, and the changelog keeps the record.',
  },
  {
    file: '03-waitlist-welcome',
    type: 'waitlist_welcome',
    from: { name: 'Daniel from Intake', email: 'daniel@intake.calder.click' },
    replyTo: 'daniel@intake.calder.click',
    variables: {},
    note: 'The existing signup letter, now wearing the same clothes: mark, card, unsubscribe.',
  },
  {
    file: '04-provider-disconnected',
    type: 'provider_connection_removed',
    from: { name: 'Intake', email: 'noreply@intake.calder.click' },
    replyTo: 'noreply@intake.calder.click',
    variables: {
      providerName: 'Typeform',
      accountLabel: 'oluwadare458@gmail.com',
      timestamp: '29 Oct 2026, 12:55 UTC',
      connectionsUrl: `${SITE}/app/connections`,
      userName: 'Daniel Oluwadare',
    },
    note: 'The security notice a provider connection sends when it ends.',
  },
  {
    file: '05-welcome-signed-up',
    type: 'welcome',
    from: { name: 'Daniel from Intake', email: 'daniel@intake.calder.click' },
    replyTo: 'daniel@intake.calder.click',
    variables: { userName: 'Ada', dashboardUrl: `${SITE}/app`, dailyCredits: '20' },
    note: 'The account welcome, for comparison across the two footers (transactional vs. list).',
  },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character));
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin: 0; background: #e9e3d7; color: #0c0c0b; font: 15px/1.6 'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: baseline; padding: 14px 26px; background: #0c0c0b; color: #f4efe6 }
  .bar strong { font-size: 14px; letter-spacing: -.01em }
  .bar a { color: #ffb08a; text-decoration: none; font-size: 13px }
  .bar a:hover { color: #fff }
  .bar span { font-size: 12px; color: #a8a29a }
  .grid { display: grid; gap: 30px; padding: 30px 26px 60px; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); align-items: start }
  .item { background: #f7f3ea; border: 1px solid #d9d0bf; border-radius: 10px; overflow: hidden }
  .caption { padding: 16px 18px 14px; border-bottom: 1px solid #e2dacb; background: #fffdf9 }
  .caption h2 { margin: 0 0 4px; font: 400 19px/1.3 'Fraunces Variable', Georgia, serif; letter-spacing: -.01em }
  .caption p { margin: 0; font-size: 13px; color: #6f6a5f }
  .inbox { display: grid; grid-template-columns: 150px 1fr; gap: 4px 14px; margin: 12px 0 0; font-size: 12.5px }
  .inbox dt { font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8478; padding-top: 2px }
  .inbox dd { margin: 0; color: #24231f }
  iframe { display: block; width: 100%; height: 1180px; border: 0; background: #f4efe6 }
  details { border-top: 1px solid #e2dacb; background: #fffdf9 }
  details summary { cursor: pointer; padding: 11px 18px; font: 600 11px/1.4 ui-monospace, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: #6f6a5f }
  details pre { margin: 0; padding: 0 18px 18px; white-space: pre-wrap; font: 12.5px/1.6 ui-monospace, Menlo, monospace; color: #24231f }
</style></head>
<body>${body}</body></html>`;
}

const cards: string[] = [];

await mkdir(join(OUT, 'brand'), { recursive: true });
await copyFile(join(import.meta.dirname, '..', 'public', 'brand', 'intake-mark.png'), join(OUT, 'brand', 'intake-mark.png'));

for (const preview of PREVIEWS) {
  const rendered = renderEmail(preview.type, preview.variables, {
    visuals: VISUALS,
    unsubscribeUrl: preview.type === 'welcome' ? undefined : UNSUBSCRIBE,
  });
  await writeFile(join(OUT, `${preview.file}.html`), rendered.html, 'utf8');
  cards.push(`<div class="item">
  <div class="caption">
    <h2>${escapeHtml(preview.note)}</h2>
    <dl class="inbox">
      <dt>From</dt><dd>${escapeHtml(preview.from.name)} &lt;${escapeHtml(preview.from.email)}&gt;</dd>
      <dt>Reply-to</dt><dd>${escapeHtml(preview.replyTo)}</dd>
      <dt>Subject</dt><dd><strong>${escapeHtml(rendered.subject)}</strong></dd>
      <dt>Preview</dt><dd>${escapeHtml(rendered.text.split('\n').filter(Boolean)[1] ?? '')}</dd>
    </dl>
  </div>
  <iframe src="./${preview.file}.html" title="${escapeHtml(preview.note)}" loading="lazy"></iframe>
  <details><summary>Plaintext alternative</summary><pre>${escapeHtml(rendered.text)}</pre></details>
</div>`);
}

await writeFile(join(OUT, 'index.html'), page('Intake emails — preview', `<div class="bar">
  <strong>Intake · email preview</strong>
  <span>Rendered by <code>scripts/preview-emails.ts</code> — this is the exact HTML a mail client receives.</span>
  <a href="./brand/intake-mark.png" target="_blank" rel="noreferrer">check the logo asset</a>
</div>
<div class="grid">${cards.join('\n')}</div>`), 'utf8');

console.log(`Wrote ${PREVIEWS.length + 1} files to docs/email-preview/`);
