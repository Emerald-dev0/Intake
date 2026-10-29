import { type ReactNode } from 'react';
import { MarketingFooter, MarketingNav, StartLink } from './MarketingChrome';
import { Reveal } from './MarketingSections';
import { MobileActionBar } from './MobileActionBar';
import { usePageMeta, webPageSchema } from './usePageMeta';
import { usePublicSession } from './usePublicSession';
import { useSiteAnalytics } from '../lib/analytics';
import type { AnalyticsPath } from '../lib/analytics';

/**
 * The shared shell for the content hubs: nav, page head, footer, action bar and metadata.
 *
 * It lives in its own module because the changelog needs the same shell as the other hubs, and
 * the changelog now spans two pages (index and release detail) plus a route the analytics
 * allowlist does not track.
 */
export function HubShell({ path, title, description, eyebrow, heading, lede, children, analyticsPath, article, schema, image }: {
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: ReactNode;
  lede: string;
  children: ReactNode;
  /** The tracked path. Omitted for pages the analytics allowlist does not cover. */
  analyticsPath?: AnalyticsPath;
  article?: { publishedTime: string | null; modifiedTime?: string | null };
  /** Structured data for the page. Defaults to a plain WebPage node. */
  schema?: Record<string, unknown>;
  /** An absolute image for the social preview. The site's default card is used when it is absent. */
  image?: string | null;
}) {
  const authenticated = usePublicSession();
  if (analyticsPath) useSiteAnalytics(analyticsPath);
  usePageMeta({
    title,
    description,
    path,
    schema: schema ?? webPageSchema(path, title, description),
    article,
    image,
  });
  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MarketingNav authenticated={authenticated} />
      <main id="main-content" tabIndex={-1}>
        <section className="mk-section mk-hub-head" aria-labelledby="mk-hub-title">
          <div className="mk-container">
            <span className="mk-eyebrow">{eyebrow}</span>
            <h1 id="mk-hub-title">{heading}</h1>
            <p className="mk-hub-lede">{lede}</p>
          </div>
        </section>
        {children}
        <section className="mk-section mk-hub-cta" aria-label="Get started">
          <div className="mk-container">
            <Reveal variant="rise">
              <h2>Your first form is one sentence away.</h2>
              <p>Free during launch · 20 credits daily · No card needed</p>
              <StartLink authenticated={authenticated} />
            </Reveal>
          </div>
        </section>
      </main>
      <MarketingFooter authenticated={authenticated} />
      <MobileActionBar authenticated={authenticated} />
    </div>
  );
}
