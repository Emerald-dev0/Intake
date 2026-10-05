import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  CREATOR,
  FAQS,
  HOMEPAGE_TITLE,
  META_DESCRIPTION,
  PRODUCT_DESCRIPTION,
  SITE_NAME,
  WORKFLOW_STEPS,
} from './src/content/site.ts';
import { DEFAULT_SITE_URL, isNonPublicHost, normalizeSiteUrl } from './src/lib/site-url.ts';
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

function structuredData(siteUrl: string): string {
  const creatorId = `${siteUrl}/#creator`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${siteUrl}/#software`,
        name: SITE_NAME,
        url: `${siteUrl}/`,
        description: PRODUCT_DESCRIPTION,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Google Forms creation and editing from a written description',
        inLanguage: 'en',
        featureList: [
          'Create a Google Form from a plain-English description',
          'Review and change the proposed questions before anything is created',
          'Propose and review changes to a Google Form you already have',
          'Keep every form you make or import in a private library',
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
        '@id': `${siteUrl}/#faq`,
        url: `${siteUrl}/#faq`,
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
  const comparison = proPriceComparison();
  const proMonthly = formatUsd(comparison.monthlyCents);
  const proAnnual = formatUsd(comparison.annualCents);

  return `<main class="seo-fallback">
    <header><a href="/" aria-label="Intake home">Intake</a></header>
    <section aria-labelledby="fallback-title">
      <h1 id="fallback-title">Tell Intake what you need. It builds the form for you.</h1>
      <p>${escapeHtml(PRODUCT_DESCRIPTION)}</p>
      <p>${escapeHtml(META_DESCRIPTION)}</p>
    </section>
    <section aria-labelledby="fallback-product">
      <h2 id="fallback-product">Not another form builder.</h2>
      <p>Describe what you want to collect in a sentence. Intake turns it into a full list of questions, you adjust anything that does not fit, and the form is created in your own Google account.</p>
      <p>Editing works the same way: point Intake at a form you already have, describe the change, and confirm it once the proposal looks right.</p>
    </section>
    <section aria-labelledby="fallback-how">
      <h2 id="fallback-how">How Intake works</h2>
      <ol>${workflow}</ol>
    </section>
    <section aria-labelledby="fallback-pricing">
      <h2 id="fallback-pricing">Plans and pricing</h2>
      <h3>Free · $0</h3>
      <p>${PLAN_CATALOG.free.dailyCredits} credits every day, form creation from a description, editing for the forms you already have, a library of everything you make, and a review step before anything is applied.</p>
      <h3>Pro · ${escapeHtml(proMonthly)} per month or ${escapeHtml(proAnnual)} per year</h3>
      <p>${PLAN_CATALOG.pro.dailyCredits} credits a day plus ${PLAN_CATALOG.pro.monthlyCredits} a month, with every workflow from Free unchanged. Daily credits are used first and unused credits do not roll over.</p>
    </section>
    <section id="faq" aria-labelledby="fallback-faq">
      <h2 id="fallback-faq">Frequently asked questions</h2>
      ${faq}
    </section>
    <footer>Designed by <a href="${escapeHtml(CREATOR.github)}">${escapeHtml(CREATOR.credit)}</a>.</footer>
  </main>`;
}

/**
 * The only canonical origin is the resolved production origin; preview hostnames (Vercel `VERCEL_URL`,
 * sandbox hosts) are never substituted. `VITE_SITE_URL` changes it deliberately at build time.
 */
function siteMeta(siteUrl: string): Plugin {
  return {
    name: 'intake-site-meta',
    transformIndexHtml(html) {
      return html
        .replace('%HOMEPAGE_TITLE%', escapeHtml(HOMEPAGE_TITLE))
        .replace('%META_DESCRIPTION%', escapeHtml(META_DESCRIPTION))
        .replace('%CREATOR_DISPLAY_NAME%', escapeHtml(CREATOR.displayName))
        .replaceAll('%SITE_URL%', siteUrl)
        .replace('%STRUCTURED_DATA%', structuredData(siteUrl))
        .replace('%NOSCRIPT_CONTENT%', noScriptContent());
    },
  };
}

const PRO_PRICE_COMPARISON = proPriceComparison();

function pricingStructuredData(siteUrl: string): string {
  const faqId = `${siteUrl}/pricing#faq`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${siteUrl}/pricing#webpage`,
        url: `${siteUrl}/pricing`,
        name: PRICING_TITLE,
        description: PRICING_DESCRIPTION,
        about: { '@id': `${siteUrl}/#software` },
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
      <p>${PLAN_CATALOG.free.dailyCredits} credits every day, refreshed at 00:00 UTC, with the full Google Forms creation and editing workflow.</p>
      <h2>Pro · ${escapeHtml(proMonthly)} per month or ${escapeHtml(proAnnual)} per year</h2>
      <p>${PLAN_CATALOG.pro.dailyCredits} credits a day plus ${PLAN_CATALOG.pro.monthlyCredits} a month. Paying annually would save ${escapeHtml(annualSavings)} compared with twelve monthly payments, and unused credits do not roll over.</p>
      <p>Start with a free account; Pro opens to existing accounts first and can be switched on from your account page. Google’s own limits apply the same way on both plans.</p>
    </section>
    <section id="faq" aria-labelledby="pricing-fallback-faq"><h2 id="pricing-fallback-faq">Pricing questions</h2>${faq}</section>
    <footer><a href="/auth/sign-up">Start with Free</a> · <a href="/">Back to Intake</a></footer>
  </main>`;
}

/** Give the pricing entry its own crawlable metadata and matching no-script fallback. */
function pricingDocument(siteUrl: string): Plugin {
  return {
    name: 'intake-pricing-document',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (context.path !== '/pricing.html' && !context.filename.endsWith('/pricing.html')) return;
        return html
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(PRICING_TITLE)}</title>`)
          .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(PRICING_DESCRIPTION)}" />`)
          .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${siteUrl}/pricing" />`)
          .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeHtml(PRICING_TITLE)}" />`)
          .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeHtml(PRICING_DESCRIPTION)}" />`)
          .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${siteUrl}/pricing" />`)
          .replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${escapeHtml(PRICING_TITLE)}" />`)
          .replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escapeHtml(PRICING_DESCRIPTION)}" />`)
          .replace(/<script id="intake-structured-data" type="application\/ld\+json">[\s\S]*?<\/script>/, `<script id="intake-structured-data" type="application/ld+json">${pricingStructuredData(siteUrl)}</script>`)
          .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${pricingNoScriptContent()}</noscript>`);
      },
    },
  };
}

/**
 * `robots.txt` and `sitemap.xml` are generated rather than kept as static files so a custom domain
 * (or the default `*.vercel.app` host) is reflected everywhere from one resolved origin. The route
 * exclusions mirror the noindex documents served by `vercel.json`.
 */
function robotsDocument(siteUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /app',
    'Disallow: /admin',
    'Disallow: /auth',
    'Disallow: /api',
    'Disallow: /private.html',
    'Disallow: /capture.html',
    'Disallow: /og.html',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemapDocument(siteUrl: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${siteUrl}/</loc>`,
    '  </url>',
    '  <url>',
    `    <loc>${siteUrl}/pricing</loc>`,
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

function staticDocuments(siteUrl: string): Plugin {
  return {
    name: 'intake-static-documents',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsDocument(siteUrl) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapDocument(siteUrl) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // Fail the build on a malformed origin instead of shipping metadata that points somewhere wrong.
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL, DEFAULT_SITE_URL, {
    source: 'VITE_SITE_URL',
    hint: 'Set it in the Vercel project environment (or unset it to use the documented default).',
  });
  if (env.VITE_SITE_URL?.trim() && isNonPublicHost(siteUrl)) {
    console.warn(`[intake] VITE_SITE_URL points at a non-public host (${new URL(siteUrl).hostname}). Canonical URLs, the sitemap and robots.txt will use it; this is only appropriate for a local test build.`);
  }
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
    plugins: [react(), siteMeta(siteUrl), pricingDocument(siteUrl), staticDocuments(siteUrl)],
    build: { rollupOptions: { input: inputs } },
    server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy },
    preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, proxy },
  };
});
