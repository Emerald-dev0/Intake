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
import { PLAN_CATALOG, formatUsd, proPriceComparison } from './src/lib/plans.ts';
import { PRICING_DESCRIPTION, PRICING_FAQS, PRICING_TITLE } from './src/content/pricing.ts';

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

const PRO_PRICE_COMPARISON = proPriceComparison();

function pricingStructuredData(): string {
  const faqId = `${SITE_URL}/pricing#faq`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}/pricing#webpage`,
        url: `${SITE_URL}/pricing`,
        name: PRICING_TITLE,
        description: PRICING_DESCRIPTION,
        about: { '@id': `${SITE_URL}/#software` },
        mainEntity: { '@id': faqId },
      },
      {
        '@type': 'FAQPage',
        '@id': faqId,
        url: faqId,
        mainEntity: PRICING_FAQS.map(({ question, answer }) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}

function pricingNoScriptContent(): string {
  const faq = PRICING_FAQS.map(({ question, answer }) =>
    `<section><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></section>`,
  ).join('');
  const proMonthly = formatUsd(PRO_PRICE_COMPARISON.monthlyCents);
  const proAnnual = formatUsd(PRO_PRICE_COMPARISON.annualCents);
  const annualSavings = formatUsd(PRO_PRICE_COMPARISON.annualSavingsCents);
  return `<main class="seo-fallback">
    <header><a href="/" aria-label="Intake home">Intake</a></header>
    <section aria-labelledby="pricing-fallback-title">
      <h1 id="pricing-fallback-title">Intake plans and pricing</h1>
      <h2>Free · $0</h2>
      <p>${PLAN_CATALOG.free.dailyCredits} daily AI credits, refreshed at 00:00 UTC, with supported Google Forms creation and edit workflows.</p>
      <h2>Pro · ${escapeHtml(proMonthly)} per month or ${escapeHtml(proAnnual)} per year</h2>
      <p>${PLAN_CATALOG.pro.dailyCredits} daily credits plus ${PLAN_CATALOG.pro.monthlyCredits} monthly credits. Annual billing saves ${escapeHtml(annualSavings)} compared with twelve monthly payments. Unused credits do not roll over.</p>
      <p>Intake does not process payments or allow plan changes yet. The annual/monthly switch is display-only. Google Forms and AI-provider limits are the same across plans; priority processing is not offered.</p>
    </section>
    <section id="faq" aria-labelledby="pricing-fallback-faq"><h2 id="pricing-fallback-faq">Pricing questions</h2>${faq}</section>
    <footer><a href="/auth/sign-up">Start with Free</a> · <a href="/">Back to Intake</a></footer>
  </main>`;
}

/** Give the pricing entry its own crawlable metadata and matching no-script fallback. */
function pricingDocument(): Plugin {
  return {
    name: 'intake-pricing-document',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (context.path !== '/pricing.html' && !context.filename.endsWith('/pricing.html')) return;
        return html
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(PRICING_TITLE)}</title>`)
          .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(PRICING_DESCRIPTION)}" />`)
          .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${SITE_URL}/pricing" />`)
          .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeHtml(PRICING_TITLE)}" />`)
          .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeHtml(PRICING_DESCRIPTION)}" />`)
          .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${SITE_URL}/pricing" />`)
          .replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${escapeHtml(PRICING_TITLE)}" />`)
          .replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escapeHtml(PRICING_DESCRIPTION)}" />`)
          .replace(/<script id="intake-structured-data" type="application\/ld\+json">[\s\S]*?<\/script>/, `<script id="intake-structured-data" type="application/ld+json">${pricingStructuredData()}</script>`)
          .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${pricingNoScriptContent()}</noscript>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxy = { '^/api(?:/|$)': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001' } };
  const inputs: Record<string, string> = {
    main: 'index.html',
    private: 'private.html',
    pricing: 'pricing.html',
  };
  // CAPTURE=1 also builds the dev-only pages used to record demos / render the social card.
  if (env.CAPTURE) {
    inputs.capture = 'capture.html';
    inputs.og = 'og.html';
  }

  return {
    plugins: [react(), siteMeta(), pricingDocument()],
    build: { rollupOptions: { input: inputs } },
    server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy },
    preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, proxy },
  };
});
