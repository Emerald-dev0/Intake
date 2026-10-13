import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { AnalyticsData } from './types';

export function RechartsRankBar({ data, title }: { data: AnalyticsData['topPages']; title: string }) {
  const total = data.reduce((s, r) => s + r.count, 0);
  return (
    <section className="admin-panel">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="count" name="count" fill="#ff5a1f" />
          <span>
            {data.map((r) => (
              <span key={r.name}>
                {r.name}: {r.count} ({Math.round((r.count / total) * 100)}%)
              </span>
            ))}
          </span>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}