import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { fetchHealthSeries } from '@/lib/supabase/api';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';

const fmt = (iso: string, hours: number) =>
  new Intl.DateTimeFormat('ru-RU', hours > 48
    ? { day: '2-digit', month: 'short' }
    : { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Время ответа по результатам проверок. Недоступные проверки (без ответа) на графике не рисуются. */
export function ResponseChart({ serviceId, hours = 24 }: { serviceId: string; hours?: number }) {
  const { data, loading, error, reload } = useAsync(() => fetchHealthSeries(serviceId, hours), [serviceId, hours]);
  const pts = (data ?? [])
    .filter((p) => p.response_time != null)
    .map((p) => ({ name: fmt(p.checked_at, hours), ms: p.response_time as number }));

  return (
    <div className="h-56">
      {loading ? (
        <Skeleton className="h-full w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : pts.length === 0 ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Проверок за период нет" hint="Данные появятся после первого запуска монитора." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pts} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="rt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3DBE7A" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#3DBE7A" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#252A34" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="name" stroke="#9299A7" fontSize={11} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis stroke="#9299A7" fontSize={11} tickLine={false} axisLine={false} unit=" мс" width={64} />
            <Tooltip
              contentStyle={{ background: '#161A21', border: '1px solid #252A34', borderRadius: 12, fontSize: 12 }}
              formatter={(v: number) => [`${v} мс`, 'Ответ']}
            />
            <Area type="monotone" dataKey="ms" stroke="#3DBE7A" strokeWidth={2} fill="url(#rt)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
