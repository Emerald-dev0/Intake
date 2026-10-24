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
  /** True only when the code came from an edge geo header. */
  countryPrecise: boolean;
}

export interface AnalyticsDayPoint {
  day: string;
  pageviews: number;
  clicks: number;
  /** New accounts created that day. Present so one chart can answer "did traffic become users". */
  signups: number;
  formsCreated: number;
}

export interface AnalyticsHourPoint {
  /** UTC hour, 0–23. Timezone is deliberately not inferred: visitors are not identified. */
  hour: number;
  pageviews: number;
  clicks: number;
}

/** Each step is counted from events and accounts, never from a visitor: the rates are aggregates. */
export interface AnalyticsFunnel {
  pageviews: number;
  clicks: number;
  signups: number;
  formsCreated: number;
  /** clicks ÷ page views, 0–1. Null when there is nothing to divide by. */
  viewToClick: number | null;
  clickToSignup: number | null;
  viewToSignup: number | null;
  signupToForm: number | null;
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
  byHour: AnalyticsHourPoint[];
  funnel: AnalyticsFunnel;
  /** The immediately preceding window of the same length, for deltas. Never a forecast. */
  previous: { pageviews: number; clicks: number; signups: number; formsCreated: number };
  topPages: AnalyticsTopRow[];
  topReferrers: AnalyticsTopRow[];
  topSources: AnalyticsTopRow[];
  topClicks: AnalyticsTopRow[];
  topCountries: AnalyticsTopRow[];
  topCampaigns: AnalyticsTopRow[];
  topMediums: AnalyticsTopRow[];
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
        `INSERT INTO site_events (day, kind, path, label, referrer_host, utm_source, utm_medium, utm_campaign, country, time_zone, country_precise)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.kind, input.path, input.label, input.referrerHost, input.utmSource, input.utmMedium, input.utmCampaign, input.country, input.timeZone, input.countryPrecise],
      );
    },

    async summary(bounds: AnalyticsBounds): Promise<AnalyticsSummary> {
      const { rows: present } = await pool.query(`SELECT to_regclass('public.site_events')::text AS present`);
      if (!present[0]?.present) {
        return emptySummary('Site analytics start after migration 013. Run npm run db:migrate:intake.');
      }
      const span = bounds.to.getTime() - bounds.from.getTime();
      const previousBounds = { from: new Date(bounds.from.getTime() - span), to: bounds.from };
      const safe = (sql: string, params: unknown[] = []) =>
        pool.query(sql, params).catch(() => ({ rows: [] as Record<string, unknown>[], rowCount: 0 }));

      const [totals, byDay, signupDays, formDays, byHour, topPages, topReferrers, topSources, topClicks, topCountries, topCampaigns, topMediums, signups, forms, previousTotals, previousSignups, previousForms] = await Promise.all([
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
        safe(`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*) AS count FROM "user"
              WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1`, [bounds.from, bounds.to]),
        safe(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*) AS count FROM form
              WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`, [bounds.from, bounds.to]),
        // Hour of day only, in UTC: a timezone is a fingerprint, so it is not stored per event.
        safe(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int AS hour,
                COUNT(*) FILTER (WHERE kind = 'pageview') AS pageviews,
                COUNT(*) FILTER (WHERE kind = 'click') AS clicks
              FROM site_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 1`, [bounds.from, bounds.to]),
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
        safe(
          `SELECT country AS name, COUNT(*) AS count, BOOL_OR(country_precise) AS precise FROM site_events
           WHERE kind = 'pageview' AND country <> '' AND created_at >= $1 AND created_at < $2
           GROUP BY country ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        safe(
          `SELECT utm_campaign AS name, COUNT(*) AS count FROM site_events
           WHERE kind = 'pageview' AND utm_campaign <> '' AND created_at >= $1 AND created_at < $2
           GROUP BY utm_campaign ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        safe(
          `SELECT COALESCE(NULLIF(utm_medium, ''), '(none)') AS name, COUNT(*) AS count FROM site_events
           WHERE kind = 'pageview' AND utm_source <> '' AND created_at >= $1 AND created_at < $2
           GROUP BY 1 ORDER BY count DESC LIMIT 10`,
          [bounds.from, bounds.to],
        ),
        safe(`SELECT COUNT(*) AS count FROM "user" WHERE "createdAt" >= $1 AND "createdAt" < $2`, [bounds.from, bounds.to]),
        safe(`SELECT COUNT(*) AS count FROM form WHERE created_at >= $1 AND created_at < $2`, [bounds.from, bounds.to]),
        safe(`SELECT kind, COUNT(*) AS count FROM site_events WHERE created_at >= $1 AND created_at < $2 GROUP BY kind`, [previousBounds.from, previousBounds.to]),
        safe(`SELECT COUNT(*) AS count FROM "user" WHERE "createdAt" >= $1 AND "createdAt" < $2`, [previousBounds.from, previousBounds.to]),
        safe(`SELECT COUNT(*) AS count FROM form WHERE created_at >= $1 AND created_at < $2`, [previousBounds.from, previousBounds.to]),
      ]);

      let pageviews = 0;
      let clicks = 0;
      for (const row of totals.rows) {
        if (row.kind === 'pageview') pageviews = count(row);
        else if (row.kind === 'click') clicks = count(row);
      }
      const signupCount = signups.rows.length ? count(signups.rows[0]!) : 0;
      const formCount = forms.rows.length ? count(forms.rows[0]!) : 0;

      const signupsByDay = new Map(signupDays.rows.map(row => [dayString(row.day), count(row)]));
      const formsByDay = new Map(formDays.rows.map(row => [dayString(row.day), count(row)]));
      const eventsByDay = new Map(byDay.rows.map(row => [dayString(row.day), row]));
      // Every day in the window appears, including quiet ones: a growth chart that skips empty days
      // draws a straight line through a gap and implies traffic that never happened.
      const daily: AnalyticsDayPoint[] = [];
      for (let cursor = new Date(Date.UTC(bounds.from.getUTCFullYear(), bounds.from.getUTCMonth(), bounds.from.getUTCDate()));
           cursor.getTime() < bounds.to.getTime(); cursor = new Date(cursor.getTime() + 86_400_000)) {
        const day = cursor.toISOString().slice(0, 10);
        const row = eventsByDay.get(day);
        daily.push({
          day,
          pageviews: row ? Number(row.pageviews) || 0 : 0,
          clicks: row ? Number(row.clicks) || 0 : 0,
          signups: signupsByDay.get(day) ?? 0,
          formsCreated: formsByDay.get(day) ?? 0,
        });
      }

      const hours: AnalyticsHourPoint[] = Array.from({ length: 24 }, (_, hour) => {
        const row = byHour.rows.find(entry => Number(entry.hour) === hour);
        return { hour, pageviews: row ? Number(row.pageviews) || 0 : 0, clicks: row ? Number(row.clicks) || 0 : 0 };
      });

      let previousPageviews = 0;
      let previousClicks = 0;
      for (const row of previousTotals.rows) {
        if (row.kind === 'pageview') previousPageviews = count(row);
        else if (row.kind === 'click') previousClicks = count(row);
      }

      return {
        available: true,
        reason: null,
        pageviews,
        clicks,
        signups: signupCount,
        formsCreated: formCount,
        byDay: daily,
        byHour: hours,
        funnel: funnelOf({ pageviews, clicks, signups: signupCount, formsCreated: formCount }),
        previous: {
          pageviews: previousPageviews,
          clicks: previousClicks,
          signups: previousSignups.rows.length ? count(previousSignups.rows[0]!) : 0,
          formsCreated: previousForms.rows.length ? count(previousForms.rows[0]!) : 0,
        },
        topCountries: topCountries.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        countryPrecise: topCountries.rows.some(row => row.precise === true),
        topPages: topPages.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topReferrers: topReferrers.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topSources: topSources.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topClicks: topClicks.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topCampaigns: topCampaigns.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
        topMediums: topMediums.rows.map(row => ({ name: String(row.name ?? ''), count: count(row) })),
      };
    },
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;
}

export function funnelOf(steps: { pageviews: number; clicks: number; signups: number; formsCreated: number }): AnalyticsFunnel {
  return {
    ...steps,
    viewToClick: ratio(steps.clicks, steps.pageviews),
    clickToSignup: ratio(steps.signups, steps.clicks),
    viewToSignup: ratio(steps.signups, steps.pageviews),
    signupToForm: ratio(steps.formsCreated, steps.signups),
  };
}

function emptySummary(reason: string): AnalyticsSummary {
  return {
    available: false,
    reason,
    pageviews: 0, clicks: 0, signups: 0, formsCreated: 0,
    byDay: [], byHour: [],
    funnel: funnelOf({ pageviews: 0, clicks: 0, signups: 0, formsCreated: 0 }),
    previous: { pageviews: 0, clicks: 0, signups: 0, formsCreated: 0 },
    topPages: [], topReferrers: [], topSources: [], topClicks: [], topCountries: [],
    topCampaigns: [], topMediums: [], countryPrecise: false,
  };
}

export type AnalyticsStore = ReturnType<typeof createPostgresAnalyticsStore>;
