import { useMemo, useState } from 'react';
import { Eye, Hammer, RefreshCw, Server, ShieldCheck, ShieldAlert, UserCheck, Users } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { VisitsChart } from '@/components/dashboard/VisitsChart';
import { ServiceStatusList } from '@/components/dashboard/ServiceStatusList';
import { RecentEvents } from '@/components/dashboard/RecentEvents';
import { ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchTotals } from '@/lib/supabase/api';
import { formatNumber, pctChange, resolveRange } from '@/utils/format';
import type { Period } from '@/types';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: '7d', label: '7 дней' },
  { key: '30d', label: '30 дней' },
  { key: '90d', label: '90 дней' },
  { key: '12m', label: '12 месяцев' },
  { key: 'custom', label: 'Период' },
];

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export default function Dashboard() {
  const toast = useToast();
  const { rows, loading, error, reload } = useServices();

  const [period, setPeriod] = useState<Period>('7d');
  const [custom, setCustom] = useState(() => ({
    from: ymd(new Date(Date.now() - 7 * 86_400_000)),
    to: ymd(new Date()),
  }));

  // Диапазон пересчитывается только при смене периода / дат, а не на каждый рендер.
  const range = useMemo(() => resolveRange(period, custom), [period, custom]);

  const totals = useAsync(
    () => fetchTotals(range.from, range.to),
    [range.from.getTime(), range.to.getTime()],
  );

  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const unknown = count('unknown');
  const analyticsDown = Boolean(totals.error);
  const t = totals.data;

  const refresh = () => {
    reload();
    totals.reload();
    toast('success', 'Данные обновлены');
  };

  if (error) {
    return (
      <div className="card">
        <ErrorState
          message={`${error}. Проверьте, что миграция применена, а ваш аккаунт добавлен в cc_admin_users.`}
          onRetry={reload}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-xl border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                  period === p.key ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input !w-auto !py-1.5"
                value={custom.from}
                max={custom.to}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
                aria-label="Начало периода"
              />
              <span className="text-muted">—</span>
              <input
                type="date"
                className="input !w-auto !py-1.5"
                value={custom.to}
                min={custom.from}
                max={ymd(new Date())}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                aria-label="Конец периода"
              />
            </div>
          )}
        </div>
        <button className="btn" onClick={refresh}>
          <RefreshCw className="h-4 w-4" /> Обновить
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Services"
          icon={Server}
          loading={loading}
          value={formatNumber(rows.length)}
          hint="зарегистрировано"
        />
        <StatCard
          label="Operational"
          icon={ShieldCheck}
          tone="text-ok"
          loading={loading}
          value={formatNumber(count('operational'))}
          hint={unknown > 0 ? `у ${unknown} нет данных проверок` : 'по последним проверкам'}
        />
        <StatCard
          label="Maintenance"
          icon={Hammer}
          tone="text-maint"
          loading={loading}
          value={formatNumber(count('maintenance'))}
          hint="по настройкам администратора"
        />
        <StatCard
          label="Unavailable"
          icon={ShieldAlert}
          tone="text-bad"
          loading={loading}
          value={formatNumber(count('unavailable'))}
          hint={count('degraded') > 0 ? `ещё ${count('degraded')} с ограничениями` : 'по последним проверкам'}
        />
        <StatCard
          label="Total Visitors"
          icon={Users}
          loading={totals.loading}
          unavailable={analyticsDown}
          value={t ? formatNumber(t.visitors) : null}
          delta={t ? pctChange(t.visitors, t.prev_visitors) : null}
          hint="уникальных за период"
        />
        <StatCard
          label="Page Views"
          icon={Eye}
          loading={totals.loading}
          unavailable={analyticsDown}
          value={t ? formatNumber(t.page_views) : null}
          delta={t ? pctChange(t.page_views, t.prev_page_views) : null}
          hint="просмотров за период"
        />
        <StatCard
          label="Active Today"
          icon={UserCheck}
          loading={totals.loading}
          unavailable={analyticsDown}
          value={t ? formatNumber(t.active_24h) : null}
          hint="посетителей за 24 часа"
        />
      </div>

      <VisitsChart range={range} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ServiceStatusList />
        <RecentEvents />
      </div>
    </div>
  );
}
