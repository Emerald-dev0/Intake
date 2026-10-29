import { useEffect } from 'react';
import { SITE_URL } from '../content/site';

/**
 * Per-page metadata for the content hubs. The homepage and pricing carry static
 * metadata through the build plugin; these pages set theirs at runtime and
 * inject a WebPage schema node — enough for the crawlers that render JavaScript.
 */
export function usePageMeta({ title, description, path, schema, article }: {
  title: string;
  description: string;
  path: string;
  schema?: Record<string, unknown>;
  /** Article metadata for dated pages such as a changelog release. */
  article?: { publishedTime: string | null; modifiedTime?: string | null };
}) {
  useEffect(() => {
    document.title = title;
    const url = `${SITE_URL}${path}`;
    const setMeta = (selector: string, attribute: string, value: string) => {
      let node = document.head.querySelector<HTMLMetaElement>(selector);
      if (!node) {
        node = document.createElement('meta');
        document.head.append(node);
      }
      node.setAttribute(attribute, value);
      // Rebuild the selector attributes for freshly created nodes.
      if (selector.startsWith('meta[name="')) node.name = selector.slice(11, -2);
      if (selector.startsWith('meta[property="')) node.setAttribute('property', selector.slice(15, -2));
    };
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('meta[property="og:type"]', 'content', article ? 'article' : 'website');
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    if (article?.publishedTime) setMeta('meta[property="article:published_time"]', 'content', article.publishedTime);
    if (article?.modifiedTime) setMeta('meta[property="article:modified_time"]', 'content', article.modifiedTime);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = url;

    const scriptId = 'intake-page-schema';
    document.getElementById(scriptId)?.remove();
    if (schema) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(schema).replace(/</g, '\\u003c');
      document.head.append(script);
      return () => script.remove();
    }
    return undefined;
  }, [title, description, path, schema, article?.publishedTime, article?.modifiedTime]);
}

/** Structured data for a dated changelog release. */
export function releaseSchema(input: {
  path: string;
  name: string;
  description: string;
  publishedTime: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${SITE_URL}${input.path}#article`,
    url: `${SITE_URL}${input.path}`,
    headline: input.name,
    description: input.description,
    datePublished: input.publishedTime ?? undefined,
    author: { '@id': `${SITE_URL}/#creator` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    isPartOf: { '@id': `${SITE_URL}/#website` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}${input.path}` },
  };
}

export function webPageSchema(path: string, name: string, description: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}${path}#webpage`,
    url: `${SITE_URL}${path}`,
    name,
    description,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: { '@id': `${SITE_URL}/#software` },
  };
}
