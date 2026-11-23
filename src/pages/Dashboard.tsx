import { Eye, Hammer, RefreshCw, Server, ShieldCheck, ShieldAlert, UserCheck, Users } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { VisitsChart } from '@/components/dashboard/VisitsChart';
import { ServiceStatusList } from '@/components/dashboard/ServiceStatusList';
import { RecentEvents } from '@/components/dashboard/RecentEvents';
import { PeriodPicker, useRangeState } from '@/components/ui/PeriodPicker';
import { ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchTotals } from '@/lib/supabase/api';
import { formatNumber, pctChange } from '@/utils/format';

export default function Dashboard() {
  const toast = useToast();
  const { rows, loading, error, reload } = useServices();
  const { period, setPeriod, custom, setCustom, range, nonce, refresh } = useRangeState('7d');

  const totals = useAsync(
    () => fetchTotals(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );

  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const unknown = count('unknown');
  const analyticsDown = Boolean(totals.error);
  const t = totals.data;

  const onRefresh = () => {
    reload();
    refresh();
    toast('success', 'Данные обновлены');
  };

  if (error) {
    return (
      <div className="card">
        <ErrorState
          message={`${error}. Проверьте, что миграции применены, а ваш аккаунт добавлен в cc_admin_users.`}
          onRetry={reload}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        <button className="btn" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" /> Обновить
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Services" icon={Server} loading={loading} value={formatNumber(rows.length)} hint="зарегистрировано" />
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

      <VisitsChart range={range} nonce={nonce} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ServiceStatusList />
        <RecentEvents />
      </div>
    </div>
  );
}
