import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  CREATOR,
  FAQS,
  HOMEPAGE_TITLE,
  META_DESCRIPTION,
  PRODUCT_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  WORKFLOW_STEPS,
} from './src/content/site.ts';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function structuredData(): string {
  const creatorId = `${SITE_URL}/#creator`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#software`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: PRODUCT_DESCRIPTION,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'AI-assisted Google Forms creation and editing',
        inLanguage: 'en',
        featureList: [
          'Create structured Google Forms from natural-language requests',
          'Review and revise an AI-generated form proposal before creation',
          'Propose and review supported changes to existing Google Forms',
          'Manage Intake-created and imported Google Forms in a private library',
        ],
        creator: { '@id': creatorId },
        author: { '@id': creatorId },
      },
      {
        '@type': 'Person',
        '@id': creatorId,
        name: CREATOR.displayName,
        alternateName: CREATOR.identity,
        jobTitle: 'Software developer',
        sameAs: [...CREATOR.profiles],
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        url: `${SITE_URL}/#faq`,
        mainEntity: FAQS.map(({ question, answer }) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: answer,
          },
        })),
      },
    ],
  };
  // Protect the inline JSON-LD script boundary if copy ever includes HTML-like text.
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}

function noScriptContent(): string {
  const workflow = WORKFLOW_STEPS.map(({ title, body }) =>
    `<li><strong>${escapeHtml(title)}.</strong> ${escapeHtml(body)}</li>`,
  ).join('');
  const faq = FAQS.map(({ question, answer }) =>
    `<section><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></section>`,
  ).join('');

  return `<main class="seo-fallback">
    <header><a href="/" aria-label="Intake home">Intake</a></header>
    <section aria-labelledby="fallback-title">
      <h1 id="fallback-title">${escapeHtml(HOMEPAGE_TITLE.replace(/^Intake — /, ''))}</h1>
      <p>${escapeHtml(PRODUCT_DESCRIPTION)}</p>
      <p>${escapeHtml(META_DESCRIPTION)}</p>
    </section>
    <section aria-labelledby="fallback-how">
      <h2 id="fallback-how">How Intake works</h2>
      <ol>${workflow}</ol>
    </section>
    <section id="faq" aria-labelledby="fallback-faq">
      <h2 id="fallback-faq">Frequently asked questions</h2>
      ${faq}
    </section>
    <footer>Built by <a href="${escapeHtml(CREATOR.github)}">${escapeHtml(CREATOR.displayName)}</a>.</footer>
  </main>`;
}

/** The only canonical origin is the actual production domain; preview hostnames are never substituted. */
function siteMeta(): Plugin {
  return {
    name: 'intake-site-meta',
    transformIndexHtml(html) {
      return html
        .replace('%HOMEPAGE_TITLE%', escapeHtml(HOMEPAGE_TITLE))
        .replace('%META_DESCRIPTION%', escapeHtml(META_DESCRIPTION))
        .replace('%CREATOR_DISPLAY_NAME%', escapeHtml(CREATOR.displayName))
        .replaceAll('%SITE_URL%', SITE_URL)
        .replace('%STRUCTURED_DATA%', structuredData())
        .replace('%NOSCRIPT_CONTENT%', noScriptContent());
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxy = { '^/api(?:/|$)': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001' } };
  const inputs: Record<string, string> = {
    main: 'index.html',
    private: 'private.html',
  };
  // CAPTURE=1 also builds the dev-only pages used to record demos / render the social card.
  if (env.CAPTURE) {
    inputs.capture = 'capture.html';
    inputs.og = 'og.html';
  }

  return {
    plugins: [react(), siteMeta()],
    build: { rollupOptions: { input: inputs } },
    server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy },
    preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, proxy },
  };
});
