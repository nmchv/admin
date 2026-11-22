import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { fetchSeries } from '@/lib/supabase/api';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatBucket, formatNumber, type Range } from '@/utils/format';
import type { Metric } from '@/types';

const METRICS: { key: Metric; label: string }[] = [
  { key: 'visitors', label: 'Посетители' },
  { key: 'sessions', label: 'Сессии' },
  { key: 'page_views', label: 'Просмотры' },
];

export function VisitsChart({ range }: { range: Range }) {
  const [metric, setMetric] = useState<Metric>('visitors');
  const { data, loading, error, reload } = useAsync(
    () => fetchSeries(range.from, range.to, range.bucket),
    [range.from.getTime(), range.to.getTime(), range.bucket],
  );

  const label = METRICS.find((m) => m.key === metric)!.label;
  const points = (data ?? []).map((p) => ({ ...p, name: formatBucket(p.bucket, range.bucket) }));
  const hasData = points.some((p) => p[metric] > 0);

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold tracking-tight">Посещаемость</h2>
        <div className="flex rounded-xl border border-line bg-bg p-0.5" role="tablist">
          {METRICS.map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                metric === m.key ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[280px]">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !hasData ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="За выбранный период данных нет"
            hint="События появятся после подключения analytics SDK к приложениям (этап 3)."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5B8DEF" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#5B8DEF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#252A34" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="name" stroke="#9299A7" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                stroke="#9299A7"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              <Tooltip
                cursor={{ stroke: '#343b49' }}
                contentStyle={{
                  background: '#181B22',
                  border: '1px solid #252A34',
                  borderRadius: 12,
                  fontSize: 12,
                  color: '#F4F5F7',
                }}
                formatter={(v: number) => [formatNumber(v), label]}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke="#5B8DEF"
                strokeWidth={2}
                fill="url(#fill)"
                dot={false}
                activeDot={{ r: 4, fill: '#5B8DEF', stroke: '#08090B', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
