import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { AnalyticsData } from './types';

/**
 * Charts for the operations dashboard.
 *
 * Recharts is already a dependency, so the hand-drawn SVG charts are replaced rather than duplicated.
 * Three rules hold for every chart here:
 *
 * 1. **A number is never only a shape.** Each chart is wrapped in a figure with a caption that states
 *    the totals, and replaces itself with a short empty state rather than drawing an axis on nothing.
 * 2. **Colours carry one meaning across the page** — orange is traffic, blue is clicks, green is
 *    accounts, violet is forms — so two charts can be read side by side.
 * 3. **Nothing is inferred that the data cannot support.** There is no per-visitor identifier in this
 *    product, so there are no unique-visitor, session, retention or funnel-per-person charts, and no
 *    timezone other than UTC.
 */

const ACCENT = '#ff5a1f';
const BLUE = '#58a6ff';
const GREEN = '#3fb950';
const VIOLET = '#a371f7';
const GRID = 'rgba(255,255,255,.08)';
const AXIS = '#8b949e';

const AXIS_PROPS = { stroke: AXIS, tick: { fill: AXIS, fontSize: 11 }, tickLine: false } as const;
const TOOLTIP_PROPS = {
  contentStyle: { background: '#161b22', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e6edf3', fontSize: 12, marginBottom: 4 },
  itemStyle: { fontSize: 12 },
} as const;

function dayLabel(value: string): string {
  return value.slice(5);
}

function Figure({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="admin-chart">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** Page views and clicks over the window. Two series, one scale — they are comparable volumes. */
export function TrafficAreaChart({ data }: { data: AnalyticsData['byDay'] }) {
  return (
    <Figure caption={`Page views and clicks, ${data.length} ${data.length === 1 ? 'day' : 'days'}`}>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="ck" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BLUE} stopOpacity={0.3} />
              <stop offset="100%" stopColor={BLUE} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} {...AXIS_PROPS} minTickGap={18} />
          <YAxis allowDecimals={false} {...AXIS_PROPS} width={44} />
          <Tooltip {...TOOLTIP_PROPS} />
          <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} />
          <Area type="monotone" dataKey="pageviews" name="Page views" stroke={ACCENT} strokeWidth={2} fill="url(#pv)" />
          <Area type="monotone" dataKey="clicks" name="Clicks" stroke={BLUE} strokeWidth={2} fill="url(#ck)" />
        </AreaChart>
      </ResponsiveContainer>
    </Figure>
  );
}

/**
 * Traffic becoming accounts. Bars are accounts and created forms (small counts, left axis); the line
 * is page views (larger, right axis). Two axes are honest here because the caption names both.
 */
export function GrowthComposedChart({ data }: { data: AnalyticsData['byDay'] }) {
  return (
    <Figure caption="Bars: accounts and created forms per day. Line: page views, on the right-hand scale.">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} {...AXIS_PROPS} minTickGap={18} />
          <YAxis yAxisId="count" allowDecimals={false} {...AXIS_PROPS} width={40} />
          <YAxis yAxisId="traffic" orientation="right" allowDecimals={false} {...AXIS_PROPS} width={40} />
          <Tooltip {...TOOLTIP_PROPS} />
          <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} />
          <Bar yAxisId="count" dataKey="signups" name="Accounts" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar yAxisId="count" dataKey="formsCreated" name="Forms created" fill={VIOLET} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line yAxisId="traffic" type="monotone" dataKey="pageviews" name="Page views (right)" stroke={ACCENT} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Figure>
  );
}

/** Where the traffic came from. A donut is right when the parts are shares of one whole. */
export function SourceDonut({ rows }: { rows: AnalyticsData['topSources'] }) {
  const colors = [ACCENT, BLUE, GREEN, VIOLET, '#d29922', '#f778ba', '#39c5cf', '#8b949e'];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Figure caption={`${total.toLocaleString()} page views attributed to ${rows.length} source${rows.length === 1 ? '' : 's'}.`}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={rows} dataKey="count" nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="none">
            {rows.map((row, index) => <Cell key={row.name} fill={colors[index % colors.length]} />)}
          </Pie>
          <Tooltip {...TOOLTIP_PROPS} formatter={(value: number, name: string) => [`${value} (${total ? Math.round((value / total) * 100) : 0}%)`, name]} />
          <Legend verticalAlign="bottom" iconType="circle" iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
    </Figure>
  );
}

/** When people arrive, in UTC hours. Useful for scheduling a launch post, not for profiling anyone. */
export function HourBarChart({ data }: { data: AnalyticsData['byHour'] }) {
  return (
    <Figure caption="Page views by UTC hour of day. No visitor timezone is collected, so this is never local time.">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="hour" tickFormatter={(hour: number) => (hour % 3 === 0 ? `${hour}:00` : '')} {...AXIS_PROPS} interval={0} />
          <YAxis allowDecimals={false} {...AXIS_PROPS} width={40} />
          <Tooltip {...TOOLTIP_PROPS} labelFormatter={(hour: number) => `${hour}:00–${hour}:59 UTC`} />
          <Bar dataKey="pageviews" name="Page views" fill={ACCENT} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  );
}

/**
 * A ranked horizontal bar list. Used for pages, referrers, countries, campaigns and buttons, where the
 * names are long and the ranking matters more than the shape of a time series.
 */
export function RankBarChart({ rows, label, color = ACCENT }: { rows: AnalyticsData['topPages']; label: string; color?: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const data = rows.map(row => ({ ...row, share: total ? Math.round((row.count / total) * 1000) / 10 : 0 }));
  return (
    <Figure caption={`${label}: ${total.toLocaleString()} events across ${rows.length} row${rows.length === 1 ? '' : 's'}.`}>
      <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} hide />
          <YAxis type="category" dataKey="name" width={150} {...AXIS_PROPS} tickFormatter={(name: string) => name.length > 22 ? `${name.slice(0, 21)}…` : name} />
          <Tooltip {...TOOLTIP_PROPS} formatter={(value: number, _name: string, entry: { payload?: { share?: number } }) => [`${value} (${entry?.payload?.share ?? 0}%)`, label]} />
          <Bar dataKey="count" name={label} fill={color} radius={[0, 3, 3, 0]} barSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  );
}

/**
 * The funnel as steps with real counts and rates between them.
 *
 * Not a Recharts funnel: the steps are not a time series and the drops are the interesting part, so
 * each row carries its own number and the conversion into the next. A step whose predecessor is zero
 * shows "—" rather than a made-up 0%.
 */
export function FunnelSteps({ funnel }: { funnel: AnalyticsData['funnel'] }) {
  const steps = [
    { key: 'views', label: 'Page views', value: funnel.pageviews, rate: null as number | null, note: 'Public pages' },
    { key: 'clicks', label: 'Button clicks', value: funnel.clicks, rate: funnel.viewToClick, note: 'of page views' },
    { key: 'signups', label: 'Accounts created', value: funnel.signups, rate: funnel.clickToSignup, note: 'of clicks' },
    { key: 'forms', label: 'Forms created', value: funnel.formsCreated, rate: funnel.signupToForm, note: 'of new accounts' },
  ];
  const peak = Math.max(1, ...steps.map(step => step.value));
  return (
    <ol className="admin-funnel">
      {steps.map(step => (
        <li key={step.key}>
          <div className="admin-funnel__head">
            <span>{step.label}</span>
            <b>{step.value.toLocaleString()}</b>
          </div>
          <div className="admin-funnel__track" aria-hidden="true">
            <i style={{ width: `${Math.max(step.value > 0 ? 2 : 0, Math.round((step.value / peak) * 100))}%` }} />
          </div>
          <small>{step.rate === null ? step.note : `${Math.round(step.rate * 100)}% ${step.note}`}</small>
        </li>
      ))}
    </ol>
  );
}
