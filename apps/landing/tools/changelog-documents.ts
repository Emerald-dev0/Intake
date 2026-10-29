import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { BUNDLED_RELEASES, type BundledRelease } from '../src/content/changelog.ts';
import { escapeHtml, releaseBodyHtml, releaseSections } from '../src/lib/release-notes.ts';

/**
 * The changelog, as documents a crawler can read.
 *
 * The changelog is a single-page application, and a link preview — the card Slack, Discord and X
 * draw when somebody pastes a link — is made from the document the server returns, before any of
 * the application runs. So the changelog gets its own documents: one for the index and one for
 * every release, each with its own title, description, canonical address, share card and the
 * release's own notes in readable HTML.
 *
 * The cards are drawn by the API (`/api/og/changelog/<slug>`), so a link shows the release it
 * points at rather than the product's homepage.
 */

/** The share card for a release, and for the changelog itself. */
function cardUrl(siteUrl: string, slug?: string): string {
  return slug ? `${siteUrl}/api/og/changelog/${slug}` : `${siteUrl}/api/og/changelog`;
}

/** "2026-10-29" as "29 October 2026". */
function longDate(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(parsed);
}

function replaceOnce(html: string, pattern: RegExp, value: string): string {
  return pattern.test(html) ? html.replace(pattern, value) : html;
}

/** The style the no-script fallback uses, taken from the document it is copied into. */
function fallbackStyle(html: string): string {
  const match = html.match(/<noscript>\s*(<style>[\s\S]*?<\/style>)/);
  return match ? match[1] : '';
}

const CHANGELOG_TITLE = 'Changelog — what Intake shipped';
const CHANGELOG_DESCRIPTION = 'Every Intake release with its own permanent page: what changed, who it is for, and how to use it.';

/** The document for the changelog index. */
function indexDocument(siteUrl: string, html: string): string {
  const url = `${siteUrl}/changelog`;
  const title = CHANGELOG_TITLE;
  const description = CHANGELOG_DESCRIPTION;
  const image = cardUrl(siteUrl);
  const imageAlt = 'The Intake changelog: the Intake mark, the words “INTAKE CHANGELOG”, and the newest release.';

  const items = BUNDLED_RELEASES.map(release => `
        <li>
          <h2><a href="/changelog/${escapeHtml(release.slug)}">${escapeHtml(release.title)}</a></h2>
          <p><time datetime="${escapeHtml(release.releaseDate ?? '')}">${escapeHtml(longDate(release.releaseDate))}</time></p>
          <p>${escapeHtml(release.summary)}</p>
        </li>`).join('');

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    isPartOf: { '@id': `${siteUrl}/#website` },
    about: { '@id': `${siteUrl}/#software` },
    image,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: BUNDLED_RELEASES.map((release, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${siteUrl}/changelog/${release.slug}`,
        name: release.title,
      })),
    },
  };

  const noscript = `<main class="seo-fallback">
      <header><a href="/" aria-label="Intake home">Intake</a></header>
      <section aria-labelledby="changelog-fallback-title">
        <h1 id="changelog-fallback-title">The Intake changelog</h1>
        <p>${escapeHtml(description)}</p>
        <ul>${items}
        </ul>
      </section>
      <footer><a href="/">Intake home</a> · <a href="/developers">Developers</a></footer>
    </main>`;

  return applyMetadata(html, {
    title,
    description,
    url,
    image,
    imageAlt,
    type: 'website',
    schema,
    noscript,
  });
}

/** The document for one release. */
function releaseDocument(siteUrl: string, html: string, release: BundledRelease): string {
  const url = `${siteUrl}/changelog/${release.slug}`;
  const title = `${release.title} — Intake changelog`;
  const description = release.summary;
  const image = cardUrl(siteUrl, release.slug);
  const imageAlt = `${release.title}: the release title, its date, and what it says.`;
  const sections = releaseSections(release.body);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    url,
    headline: release.title,
    description,
    datePublished: release.releaseDate ?? undefined,
    author: { '@id': `${siteUrl}/#creator` },
    publisher: { '@id': `${siteUrl}/#organization` },
    isPartOf: { '@id': `${siteUrl}/#website` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image,
  };

  const contents = sections.length
    ? `<nav aria-label="On this page"><h2>On this page</h2><ul>${sections.map(section => `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`).join('')}</ul></nav>`
    : '';

  const highlights = release.highlights.length
    ? `<section aria-labelledby="changed-fallback-title"><h2 id="changed-fallback-title">What changed</h2><ul>${release.highlights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`
    : '';

  const audience = release.audience
    ? `<section aria-labelledby="audience-fallback-title"><h2 id="audience-fallback-title">Who this is for</h2><p>${escapeHtml(release.audience)}</p></section>`
    : '';

  const noscript = `<main class="seo-fallback">
      <header><a href="/" aria-label="Intake home">Intake</a></header>
      <section aria-labelledby="release-fallback-title">
        <h1 id="release-fallback-title">${escapeHtml(release.title)}</h1>
        <p><time datetime="${escapeHtml(release.releaseDate ?? '')}">${escapeHtml(longDate(release.releaseDate))}</time></p>
        <p>${escapeHtml(release.summary)}</p>
        ${contents}
        <article>
${releaseBodyHtml(release.body)}
        </article>
        ${audience}
        ${highlights}
      </section>
      <footer><a href="/changelog">The whole changelog</a> · <a href="/">Intake home</a></footer>
    </main>`;

  return applyMetadata(html, {
    title,
    description,
    url,
    image,
    imageAlt,
    type: 'article',
    publishedTime: release.releaseDate,
    schema,
    noscript,
  });
}

/** Write one set of metadata into a copy of the site's document. */
function applyMetadata(html: string, meta: {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  type: 'website' | 'article';
  publishedTime?: string | null;
  schema: unknown;
  noscript: string;
}): string {
  let output = html;
  output = replaceOnce(output, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
  output = replaceOnce(output, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(meta.description)}" />`);
  output = replaceOnce(output, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${meta.url}" />`);
  output = replaceOnce(output, /<meta property="og:type" content="[^"]*"\s*\/>/, `<meta property="og:type" content="${meta.type}" />`);
  output = replaceOnce(output, /<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeHtml(meta.title)}" />`);
  output = replaceOnce(output, /<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeHtml(meta.description)}" />`);
  output = replaceOnce(output, /<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${meta.url}" />`);
  output = replaceOnce(output, /<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${meta.image}" />`);
  output = replaceOnce(output, /<meta property="og:image:alt" content="[^"]*"\s*\/>/, `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />`);
  output = replaceOnce(output, /<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`);
  output = replaceOnce(output, /<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`);
  output = replaceOnce(output, /<meta name="twitter:image" content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${meta.image}" />`);
  output = replaceOnce(output, /<meta name="twitter:image:alt" content="[^"]*"\s*\/>/, `<meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt)}" />`);
  if (meta.publishedTime) {
    output = output.replace(
      /(<meta property="og:image:height" content="630"\s*\/>)/,
      `$1\n    <meta property="article:published_time" content="${escapeHtml(meta.publishedTime)}" />`,
    );
  }
  output = replaceOnce(
    output,
    /<script id="intake-structured-data" type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script id="intake-structured-data" type="application/ld+json">${JSON.stringify(meta.schema).replace(/</g, '\\u003c')}</script>`,
  );
  output = replaceOnce(output, /<noscript>[\s\S]*?<\/noscript>/, `<noscript>${fallbackStyle(html)}${meta.noscript}</noscript>`);
  return output;
}

/**
 * The plugin.
 *
 * The index and every release get their own document in the build, so a crawler and a link
 * preview each get the release they asked for without running the application.
 */
export function changelogDocuments(siteUrl: string): Plugin {
  return {
    name: 'intake-changelog-documents',
    /**
     * The documents are written after the bundle, from the homepage document as it was built.
     *
     * The html transform runs inside the build itself, so the finished document is only known
     * once the bundle has been written — which is when this hook runs.
     */
    writeBundle(options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') return;
      const source = typeof index.source === 'string'
        ? index.source
        : Buffer.from(index.source).toString('utf8');
      const directory = options.dir ?? 'dist';
      mkdirSync(join(directory, 'changelog'), { recursive: true });
      writeFileSync(join(directory, 'changelog.html'), indexDocument(siteUrl, source));
      for (const release of BUNDLED_RELEASES) {
        writeFileSync(join(directory, 'changelog', `${release.slug}.html`), releaseDocument(siteUrl, source, release));
      }
    },
  };
}
