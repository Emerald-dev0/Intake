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
import { WAITLIST_DESCRIPTION, WAITLIST_TITLE } from './src/content/waitlist.ts';

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
        name: 'Intake, AI form builder for Google Forms and Typeform',
        alternateName: ['Intake by Calder', SITE_NAME],
        url: `${siteUrl}/`,
        description: PRODUCT_DESCRIPTION,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Google Forms and Typeform creation from a written description, with in-place Google Forms editing',
        inLanguage: 'en',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free plan with 20 daily credits. No card needed.' },
        featureList: [
          'Create a Google Form or Typeform from a plain-English description',
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
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Intake by Calder',
        alternateName: 'Intake',
        url: `${siteUrl}/`,
        logo: `${siteUrl}/favicon.svg`,
        founder: { '@id': creatorId },
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'Intake, AI form builder for Google Forms and Typeform',
        alternateName: 'Intake by Calder',
        description: META_DESCRIPTION,
        publisher: { '@id': `${siteUrl}/#organization` },
        inLanguage: 'en',
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

/**
 * The two provider marks, inlined for the no-script document. Same geometry and colours as
 * `src/components/ProviderLogos.tsx` (Simple Icons, CC0); a crawlable page should show the same
 * "Google Forms and Typeform" promise a browser sees.
 */
const FALLBACK_LOGOS = {
  google: '<svg role="img" aria-label="Google Forms" width="22" height="22" viewBox="0 0 24 24" fill="#7248B9"><path d="M14.727 6h6l-6-6v6zm0 .727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zM7.91 17.318a.819.819 0 1 1 .001-1.638.819.819 0 0 1 0 1.638zm0-3.273a.819.819 0 1 1 .001-1.637.819.819 0 0 1 0 1.637zm0-3.272a.819.819 0 1 1 .001-1.638.819.819 0 0 1 0 1.638zm9 6.409h-6.818v-1.364h6.818v1.364zm0-3.273h-6.818v-1.364h6.818v1.364zm0-3.273h-6.818V9.273h6.818v1.363z"/></svg>',
  typeform: '<svg role="img" aria-label="Typeform" height="14" viewBox="0 0 24 14.2" fill="#262627"><path d="M15.502 13.035c-.5 0-.756-.411-.756-.917 0-.505.252-.894.756-.894.513 0 .756.407.756.894-.004.515-.261.917-.756.917Zm-4.888-1.81c.292 0 .414.17.414.317 0 .357-.365.514-1.126.536 0-.442.253-.854.712-.854Zm-3.241 1.81c-.473 0-.67-.384-.67-.917 0-.527.202-.894.67-.894.477 0 .702.38.702.894 0 .537-.234.917-.702.917Zm-3.997-2.334h-.738l1.224 2.808c-.234.519-.36.648-.522.648-.171 0-.333-.138-.45-.259l-.324.43c.22.232.522.366.832.366.387 0 .685-.224.856-.626l1.413-3.371h-.725l-.738 2.012-.828-2.008Zm19.553.523c.36 0 .432.246.432.823v1.516H24v-1.914c0-.689-.473-.988-.91-.988-.386 0-.742.241-.94.688a.901.901 0 0 0-.891-.688c-.365 0-.73.232-.927.666v-.626h-.64v2.857h.64v-1.22c0-.617.324-1.114.765-1.114.36 0 .427.246.427.823v1.516h.64l-.005-1.225c0-.617.329-1.114.77-1.114Zm-5.1-.523h-.324v2.857h.639v-1.095c0-.693.306-1.163.76-1.163.118 0 .217.005.325.05l.099-.676c-.081-.009-.153-.018-.225-.018-.45 0-.774.309-.964.707V10.7h-.31Zm-2.327-.045c-.846 0-1.418.644-1.418 1.458 0 .845.58 1.475 1.418 1.475.85 0 1.431-.648 1.431-1.475-.004-.818-.594-1.458-1.431-1.458Zm-4.852 2.38c-.333 0-.581-.17-.685-.515.847-.036 1.675-.242 1.675-.988 0-.43-.423-.872-1.03-.872-.82 0-1.374.666-1.374 1.457 0 .828.545 1.476 1.36 1.476.567 0 .927-.228 1.21-.559l-.31-.42c-.329.335-.531.42-.846.42Zm-3.151-2.38c-.324 0-.648.188-.774.483v-.438h-.64v3.98h.64v-1.422c.135.205.445.34.72.34.85 0 1.3-.631 1.3-1.48-.004-.841-.445-1.463-1.246-1.463Zm-4.483-1.1H0v.622h1.18v3.38h.67v-3.38h1.166v-.622Zm9.502 1.145h-.383v.572h.383v2.285h.639v-2.285h.621v-.572h-.621v-.447c0-.286.117-.385.382-.385.1 0 .19.027.311.068l.144-.537c-.117-.067-.351-.094-.504-.094-.612 0-.972.367-.972 1.002v.393Z"/></svg>',
} as const;

function providerLogos(): string {
  return `<div class="seo-fallback__providers">
      <span>${FALLBACK_LOGOS.google} Google Forms · create and edit</span>
      <span>${FALLBACK_LOGOS.typeform} Typeform · create and import</span>
    </div>`;
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
      ${providerLogos()}
    </section>
    <section aria-labelledby="fallback-product">
      <h2 id="fallback-product">Three things the others do not do.</h2>
      <p><strong>Not another form builder.</strong> Intake writes the form, you approve it, and Google Forms or Typeform hosts it — your account, your links, your responses.</p>
      <p>Describe what you want to collect in a sentence. Intake turns it into a full list of questions, you adjust anything that does not fit, and the form is created in the Google Forms or Typeform account you chose.</p>
      <p>Editing works the same way for Google Forms: point Intake at a form you already have, describe the change, and confirm it once the proposal looks right. Typeform creation and import work today; editing a Typeform is the next step, and Intake says so instead of pretending otherwise.</p>
    </section>
    <section aria-labelledby="fallback-how">
      <h2 id="fallback-how">How Intake works</h2>
      <ol>${workflow}</ol>
    </section>
    <section aria-labelledby="fallback-pricing">
      <h2 id="fallback-pricing">Plans and pricing</h2>
      <h3>Free · $0</h3>
      <p>${PLAN_CATALOG.free.dailyCredits} credits every day, form creation in Google Forms or Typeform from a description, editing for the Google Forms you already have, a library of everything you make, and a review step before anything is applied.</p>
      <h3>Pro · opens later</h3>
      <p>Pro is not on sale yet. When it opens at ${escapeHtml(proMonthly)} per month or ${escapeHtml(proAnnual)} per year, it will add ${PLAN_CATALOG.pro.monthlyCredits} monthly credits on top of the ${PLAN_CATALOG.pro.dailyCredits} daily credits, with every workflow from Free unchanged.</p>
    </section>
    <section id="faq" aria-labelledby="fallback-faq">
      <h2 id="fallback-faq">Frequently asked questions</h2>
      ${faq}
    </section>
    <footer>Designed by <a href="${escapeHtml(CREATOR.site)}">${escapeHtml(CREATOR.credit)}</a>.</footer>
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
        .replaceAll('%WAITLIST_TITLE%', escapeHtml(WAITLIST_TITLE))
        .replaceAll('%WAITLIST_DESCRIPTION%', escapeHtml(WAITLIST_DESCRIPTION))
        .replace('%WAITLIST_SCHEMA%', JSON.stringify({
          '@context': 'https://schema.org', '@type': 'WebPage',
          name: WAITLIST_TITLE, description: WAITLIST_DESCRIPTION, url: `${siteUrl}/waitlist`,
        }).replace(/</g, '\\u003c'))
        .replace('%META_DESCRIPTION%', escapeHtml(META_DESCRIPTION))
        .replace('%CREATOR_DISPLAY_NAME%', escapeHtml(CREATOR.displayName))
        .replaceAll('%SITE_URL%', siteUrl)
        .replace('%STRUCTURED_DATA%', structuredData(siteUrl))
        .replace('%GOOGLE_VERIFICATION%', (process.env.VITE_GOOGLE_VERIFICATION || '').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":"'"}[c]!)))
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
      <h2>Pro · Coming soon</h2>
      <p>Pro is not on sale yet. When it opens at ${escapeHtml(proMonthly)} per month or ${escapeHtml(proAnnual)} per year, it will add ${PLAN_CATALOG.pro.monthlyCredits} monthly credits on top of the ${PLAN_CATALOG.pro.dailyCredits} daily credits. Paying annually would save ${escapeHtml(annualSavings)} compared with twelve monthly payments, and unused credits do not roll over.</p>
      <p>Start with a free account; Pro opens to existing accounts first and can be switched on from your account page. Google’s own limits apply the same way on both plans.</p>
    </section>
    <section id="faq" aria-labelledby="pricing-fallback-faq"><h2 id="pricing-fallback-faq">Pricing questions</h2>${faq}</section>
    <footer><a href="/waitlist">Join the wait-list</a> · <a href="/">Back to Intake</a></footer>
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
    '# AI assistants and answer engines are welcome on public pages.',
    'User-agent: GPTBot',
    'Allow: /',
    'User-agent: PerplexityBot',
    'Allow: /',
    'User-agent: ClaudeBot',
    'Allow: /',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

const SITEMAP_PATHS = ['/', '/waitlist', '/pricing', '/privacy', '/terms', '/vs', '/templates', '/guides', '/trust', '/changelog'];

function sitemapDocument(siteUrl: string): string {
  const urls = SITEMAP_PATHS.map(path => [
    '  <url>',
    `    <loc>${siteUrl}${path === '/' ? '/' : path}</loc>`,
    '  </url>',
  ].join('\n')).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** A plain-language map of the site for language models and fast human skimming. */
function llmsDocument(siteUrl: string): string {
  return [
    '# Intake, AI form builder for Google Forms and Typeform (Intake by Calder)',
    '',
    `> ${PRODUCT_DESCRIPTION} Free plan includes 20 daily credits.`,
    '',
    `- Homepage: ${siteUrl}/ — try a prompt with no signup, see the proof, compare, pricing, FAQ`,
    `- Compare: ${siteUrl}/vs — Intake vs Google's built-in AI, Typeform AI, and ChatGPT`,
    `- Templates: ${siteUrl}/templates — stealable prompts for teachers, events, HR, clinics, student orgs`,
    `- Guides: ${siteUrl}/guides — how to create a Google Form with AI in five steps`,
    `- Trust: ${siteUrl}/trust — what Intake asks Google for and what it never does`,
    `- Changelog: ${siteUrl}/changelog — what shipped and what is next`,
    `- Wait-list: ${siteUrl}/waitlist — join for early access and product updates, no account required`,
    `- Pricing: ${siteUrl}/pricing — Free forever, Pro coming soon with a waitlist`,
    `- Privacy: ${siteUrl}/privacy — written against Google's API Services User Data Policy`,
    `- Terms: ${siteUrl}/terms`,
    '',
    '## Notes for models',
    '',
    '- Intake creates real Google Forms and Typeforms in the user’s own account after explicit approval.',
    '- Editing in place applies to Google Forms; Typeform creation and import are supported, Typeform editing is not yet.',
    '- Intake never reads form responses and never requests Gmail, Drive, Calendar, Contacts, or Sheets scopes.',
    '- Google scope beyond identity: https://www.googleapis.com/auth/forms.body (create/edit owned forms).',
    '- Typeform scopes: accounts:read, forms:read, forms:write, offline. No responses, webhooks, workspaces, themes or images.',
    '',
  ].join('\n');
}

function staticDocuments(siteUrl: string): Plugin {
  return {
    name: 'intake-static-documents',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsDocument(siteUrl) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapDocument(siteUrl) });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llmsDocument(siteUrl) });
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
    waitlist: 'waitlist.html',
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
