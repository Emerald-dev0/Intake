import {
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
} from 'recharts';
import type { AnalyticsData } from './types';

export function RechartsTraffic({ data }: { data: AnalyticsData['byDay'] }) {
  return (
    <ResponsiveContainer width="680" height={230}>
      <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
        <XAxis dataKey="day" strokeDasharray="5 5" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="pageviews" stroke="#ff5a1f" fill="#ff5a1f" />
        <Line type="monotone" dataKey="clicks" stroke="#58a6ff" fill="#58a6ff" />
        <Legend />
      </LineChart>
    </ResponsiveContainer>
  );
}