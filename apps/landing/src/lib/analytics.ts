import { useEffect } from 'react';

/**
 * Privacy-first engagement beacon for public marketing pages only.
 *
 * What is sent: the allowlisted page path, a CTA label for clicks, the document referrer,
 * the browser timezone (for approximate country reach) and any UTM tags on the URL. What is
 * never sent: IP addresses, user agents, query strings, cookies or anything identifying — the
 * server accepts only that closed shape and stores aggregates, so per-visitor counting is
 * structurally impossible.
 *
 * The hook fires one pageview per mount and delegates one document-level click listener that
 * only records call-to-action navigations (auth, app, pricing). Same-page anchors, admin and
 * workspace routes are never tracked. Honors Do Not Track.
 */

export type AnalyticsPath = '/' | '/pricing' | '/vs' | '/templates' | '/guides' | '/trust' | '/changelog';

const CTA_PREFIXES = ['/auth', '/app', '/pricing'];

function optedOut(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.doNotTrack === '1';
  } catch {
    return false;
  }
}

function utm(): { utmSource: string; utmMedium: string; utmCampaign: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    const pick = (key: string) => (params.get(key) ?? '').trim().slice(0, 60);
    return { utmSource: pick('utm_source'), utmMedium: pick('utm_medium'), utmCampaign: pick('utm_campaign') };
  } catch {
    return { utmSource: '', utmMedium: '', utmCampaign: '' };
  }
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

function send(kind: 'pageview' | 'click', path: AnalyticsPath, label: string): void {
  if (optedOut()) return;
  let referrer = '';
  try {
    referrer = document.referrer;
  } catch {
    referrer = '';
  }
  const body = JSON.stringify({ kind, path, label, referrer, timeZone: timeZone(), ...utm() });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/analytics/event', blob)) return;
    }
  } catch {
    // Fall through to fetch below.
  }
  try {
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    // Analytics must never break the page.
  }
}

function clickLabel(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href') ?? '';
  if (!href || href.startsWith('#')) return null;
  if (!CTA_PREFIXES.some(prefix => href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`))) return null;
  const explicit = anchor.getAttribute('data-track')?.trim();
  if (explicit) return explicit.slice(0, 120);
  const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : href.slice(0, 120);
}

export function useSiteAnalytics(path: AnalyticsPath): void {
  useEffect(() => {
    send('pageview', path, '');
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const label = clickLabel(anchor);
      if (label) send('click', path, label);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [path]);
}
