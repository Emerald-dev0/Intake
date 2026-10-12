/**
 * Privacy-first site analytics storage.
 *
 * The table holds aggregate fuel only: day bucket, event kind, allowlisted public path,
 * click label, referrer hostname and UTM tags. No IP addresses, user agents, query strings,
 * cookies or visitor identifiers are ever accepted or stored, so "visits" always means
 * events — per-visitor counting is structurally impossible.
 */

export type SiteEventKind = 'pageview' | 'click';

export interface SiteEventInput {
  kind: SiteEventKind;
  path: string;
  label: string;
  referrerHost: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  country: string;
  timeZone: string;
}

export interface AnalyticsDayPoint {
  day: string;
  pageviews: number;
  clicks: number;
}

export interface AnalyticsTopRow {
  name: string;
  count: number;
}

export interface AnalyticsSummary {
  available: boolean;
  reason: string | null;
  pageviews: number;
  clicks: number;
  signups: number;
  formsCreated: number;
  byDay: AnalyticsDayPoint[];
  topPages: AnalyticsTopRow[];
  topReferrers: AnalyticsTopRow[];
  topSources: AnalyticsTopRow[];
  topClicks: AnalyticsTopRow[];
  topCountries: AnalyticsTopRow[];
  /** True while any pageview in range carries an edge-confirmed country code. */
  countryPrecise: boolean;
}

export interface AnalyticsBounds {
  from: Date;
  to: Date;
}

interface Pool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

function dayString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function count(row: Record<string, unknown>): number {
  const raw = row.count ?? row.value ?? 0;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function createPostgresAnalyticsStore(pool: Pool) {
  return {
    async record(input: SiteEventInput): Promise<void> {
      await pool.query(
        `INSERT INTO site_events (day, kind, path, label, referrer_host, utm_source, utm_medium, utm_campaign, country, time_zone)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [input.kind, input.path, input.label, input.referrerHost, input.utmSource, input.utmMedium, input.utmCampaign, input.country, input.timeZone],
      );
    },

    async summary(bounds: AnalyticsBounds): Promise<AnalyticsSummary> {
      const { rows: present } = await pool.query(`SELECT to_regclass('public.site_events')::text AS present`);
      if (!present[0]?.present) {
        return {
          available: false, reason: 'Site analytics start after migration 013. Run npm run db:migrate:intake.',
          pageviews: 0, clicks: 0, signups: 0, formsCreated: 0, byDay: [], topPages: [], topReferrers: [], topSources: [], topClicks: [],
          topCountries: [], countryPrecise: false,
        };
      }
      const [totals, byDay, topPages, topReferrers, topSources, topClicks, topCountries, signups, forms] = await Promise.all([
        pool.query(
          `SELECT kind, COUNT(*) AS count FROM site_events WHERE created_at >= $1 AND created_at < $2 GROUP BY kind`,
          [bounds.from, bounds.to],
        ),
        pool.query(
          `SELECT day::text AS day,
             COUNT(*) FILTER (WHERE kind = 'pageview') AS pageviews,
             COUNT(*) FILTER (WHERE kind = 'click') AS clicks
           FROM site_events WHERE created_at >= $1 AND created_at < $2 GROUP BY day ORDER BY day`,
          [bounds.from, bounds.to],
        ),
        pool.query(
          `SELECT path AS name, COUNT(*) AS count FROM site_events
           WHERE kind = 'pageview' AND created_at >= $1 AND created_at < $2 GROUP BY path ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        pool.query(
          `SELECT referrer_host AS name, COUNT(*) AS count FROM site_events
           WHERE kind = 'pageview' AND referrer_host <> '' AND created_at >= $1 AND created_at < $2
           GROUP BY referrer_host ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        pool.query(
          `SELECT COALESCE(NULLIF(utm_source, ''), '(direct)') AS name, COUNT(*) AS count FROM site_events
           WHERE kind = 'pageview' AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        pool.query(
          `SELECT label AS name, COUNT(*) AS count FROM site_events
           WHERE kind = 'click' AND label <> '' AND created_at >= $1 AND created_at < $2
           GROUP BY label ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        pool.query(
          `SELECT country AS name, COUNT(*) AS count, BOOL_OR(time_zone = '') AS precise FROM site_events
           WHERE kind = 'pageview' AND country <> '' AND created_at >= $1 AND created_at < $2
           GROUP BY country ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ).catch(() => ({ rows: [], rowCount: 0 })),
        pool.query(`SELECT COUNT(*) AS count FROM "user" WHERE "createdAt" >= $1 AND "createdAt" < $2`, [bounds.from, bounds.to])
          .catch(() => ({ rows: [{ count: 0 }], rowCount: 1 })),
        pool.query(`SELECT COUNT(*) AS count FROM form WHERE created_at >= $1 AND created_at < $2`, [bounds.from, bounds.to])
          .catch(() => ({ rows: [{ count: 0 }], rowCount: 1 })),
      ]);
      let pageviews = 0;
      let clicks = 0;
      for (const row of totals.rows) {
        if (row.kind === 'pageview') pageviews = count(row);
        else if (row.kind === 'click') clicks = count(row);
      }
      return {
        available: true,
        reason: null,
        pageviews,
        clicks,
        signups: signups.rows.length ? count(signups.rows[0]!) : 0,
        formsCreated: forms.rows.length ? count(forms.rows[0]!) : 0,
        topCountries: topCountries.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        countryPrecise: topCountries.rows.some(row => row.precise === true),
        byDay: byDay.rows.map(row => ({ day: dayString(row.day), pageviews: Number(row.pageviews) || 0, clicks: Number(row.clicks) || 0 })),
        topPages: topPages.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topReferrers: topReferrers.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topSources: topSources.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topClicks: topClicks.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
      };
    },
  };
}

export type AnalyticsStore = ReturnType<typeof createPostgresAnalyticsStore>;
