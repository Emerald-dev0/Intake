/**
 * Canonical public origin for Intake.
 *
 * The domain is deliberately **not** hardcoded into pages, the sitemap or structured data. A build
 * resolves one explicit origin:
 *
 * 1. `VITE_SITE_URL` when the operator sets it (Vercel → Project → Environment Variables), and
 * 2. `DEFAULT_SITE_URL` otherwise, so a build with no configuration still emits a real, crawlable
 *    origin instead of a placeholder.
 *
 * Rules, enforced at build time so a wrong value fails loudly instead of shipping broken metadata:
 *
 * - absolute `https:` origin (a custom domain, `www`, or the `*.vercel.app` host are all valid);
 * - no path beyond `/`, no query, no hash, no credentials, no trailing slash;
 * - never a preview hostname (`*.e2b.app`, `*-git-*`, etc.) unless the operator sets it on purpose.
 *
 * Changing this value also changes the origin shared with the API: `BETTER_AUTH_URL` must be the
 * exact origin the browser uses. See `LAUNCH.md`.
 */
export const DEFAULT_SITE_URL = 'https://intake-six-blue.vercel.app';

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i;

export interface NormalizeSiteUrlOptions {
  /** Name used in error messages, e.g. the environment variable that supplied the value. */
  source?: string;
  /** Human-facing explanation appended to errors. */
  hint?: string;
}

/**
 * Validate and canonicalise one origin. Throws a message that names the offending variable but never
 * echoes the value, so build logs cannot be used to leak a misconfigured variable.
 */
export function normalizeSiteUrl(value: string | null | undefined, fallback: string = DEFAULT_SITE_URL, options: NormalizeSiteUrlOptions = {}): string {
  const source = options.source ?? 'VITE_SITE_URL';
  const hint = options.hint ? ` ${options.hint}` : '';
  const raw = value?.trim();
  if (!raw) return fallback;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${source} must be an absolute origin such as https://intake.example.com.${hint}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${source} must not contain credentials, a query string or a fragment.${hint}`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${source} must be an origin only: no path and no trailing slash.${hint}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${source} must use https.${hint}`);
  }
  // `URL` lowercases the host, so compare the raw value: a canonical origin is conventionally
  // lowercase, and normalising an uppercase one here would hide a copy-paste mistake in the env.
  if (raw !== raw.toLowerCase()) {
    throw new Error(`${source} must be lowercase.${hint}`);
  }
  return url.origin;
}

/**
 * Report whether a value would be accepted, without throwing. Used by tooling that must degrade
 * gracefully (for example, an operator running the verification script without a build).
 */
export function describeSiteUrlProblem(value: string | null | undefined): string | null {
  try {
    normalizeSiteUrl(value, DEFAULT_SITE_URL, { source: 'VITE_SITE_URL' });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'VITE_SITE_URL is invalid.';
  }
}

/** True for hosts that must never become a canonical origin in a production build. */
export function isNonPublicHost(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return LOOPBACK.test(hostname) || hostname === 'example.com' || hostname.endsWith('.local') || hostname.endsWith('.internal');
  } catch {
    return true;
  }
}
