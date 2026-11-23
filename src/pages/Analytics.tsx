import { useState } from 'react';
import { Clock, Eye, Info, MousePointerClick, RefreshCw, RotateCw, UserPlus, Users } from 'lucide-react';
import { Breakdown } from '@/components/analytics/Breakdown';
import { BarList } from '@/components/analytics/BarList';
import { TopPages } from '@/components/analytics/TopPages';
import { StatCard } from '@/components/dashboard/StatCard';
import { VisitsChart } from '@/components/dashboard/VisitsChart';
import { PeriodPicker, useRangeState } from '@/components/ui/PeriodPicker';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchOverview, fetchTrafficByService } from '@/lib/supabase/api';
import { formatDuration, formatNumber, pctChange } from '@/utils/format';

export default function Analytics() {
  const toast = useToast();
  const { rows } = useServices();
  const { period, setPeriod, custom, setCustom, range, nonce, refresh } = useRangeState('7d');
  const [serviceId, setServiceId] = useState<string | null>(null);

  const dep = [range.from.getTime(), range.to.getTime(), serviceId, nonce];
  const overview = useAsync(() => fetchOverview(range.from, range.to, serviceId), dep);
  const traffic = useAsync(() => fetchTrafficByService(range.from, range.to), [range.from.getTime(), range.to.getTime(), nonce]);

  const o = overview.data;
  const down = Boolean(overview.error);
  const noData = !overview.loading && !down && o !== null && o.visitors === 0 && o.page_views === 0 && o.sessions === 0;
  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));
  const selected = rows.find((r) => r.service.id === serviceId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
          <select
            className="input !w-auto"
            value={serviceId ?? ''}
            onChange={(e) => setServiceId(e.target.value || null)}
            aria-label="Сервис"
          >
            <option value="">Все сервисы</option>
            {[...rows]
              .sort((a, b) => a.service.name.localeCompare(b.service.name))
              .map((r) => (
                <option key={r.service.id} value={r.service.id}>
                  {r.service.name}
                </option>
              ))}
          </select>
        </div>
        <button
          className="btn"
          onClick={() => {
            refresh();
            toast('success', 'Данные обновлены');
          }}
        >
          <RefreshCw className="h-4 w-4" /> Обновить
        </button>
      </div>

      {noData && (
        <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            За выбранный период{selected ? ` у «${selected.service.name}»` : ''} событий нет. Данные появятся после
            подключения analytics SDK к приложению — см. <code className="text-fg">docs/analytics-sdk.md</code>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Уникальные посетители"
          icon={Users}
          loading={overview.loading}
          unavailable={down}
          value={o ? formatNumber(o.visitors) : null}
          delta={o ? pctChange(o.visitors, o.prev_visitors) : null}
          hint="за период"
        />
        <StatCard
          label="Сессии"
          icon={MousePointerClick}
          loading={overview.loading}
          unavailable={down}
          value={o ? formatNumber(o.sessions) : null}
          delta={o ? pctChange(o.sessions, o.prev_sessions) : null}
          hint="за период"
        />
        <StatCard
          label="Просмотры страниц"
          icon={Eye}
          loading={overview.loading}
          unavailable={down}
          value={o ? formatNumber(o.page_views) : null}
          delta={o ? pctChange(o.page_views, o.prev_page_views) : null}
          hint="за период"
        />
        <StatCard
          label="Новые посетители"
          icon={UserPlus}
          tone="text-ok"
          loading={overview.loading}
          unavailable={down}
          value={o ? formatNumber(o.new_visitors) : null}
          hint="впервые замечены в период"
        />
        <StatCard
          label="Вернувшиеся"
          icon={RotateCw}
          loading={overview.loading}
          unavailable={down}
          value={o ? formatNumber(o.returning_visitors) : null}
          hint="были и раньше"
        />
        <StatCard
          label="Средняя сессия"
          icon={Clock}
          loading={overview.loading}
          unavailable={down}
          value={o ? formatDuration(o.avg_session_seconds) : null}
          hint="по сессиям из 2+ событий"
        />
      </div>
      {overview.error && <p className="text-xs text-bad">Не удалось загрузить сводку: {overview.error}</p>}

      <VisitsChart range={range} serviceId={serviceId} nonce={nonce} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TopPages range={range} serviceId={serviceId} nonce={nonce} />
        {serviceId === null ? (
          <BarList
            title="Популярные сервисы"
            subtitle="Уникальные посетители за период"
            loading={traffic.loading}
            error={traffic.error}
            onRetry={traffic.reload}
            items={(traffic.data ?? []).map((t) => ({
              key: t.service_id,
              label: names.get(t.service_id) ?? 'Неизвестный сервис',
              value: t.visitors,
              hint: `${formatNumber(t.sessions)} сессий · ${formatNumber(t.page_views)} просмотров`,
            }))}
          />
        ) : (
          <Breakdown dim="source" range={range} serviceId={serviceId} nonce={nonce} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {serviceId === null && <Breakdown dim="source" range={range} serviceId={serviceId} nonce={nonce} />}
        <Breakdown dim="device" range={range} serviceId={serviceId} nonce={nonce} />
        <Breakdown dim="os" range={range} serviceId={serviceId} nonce={nonce} />
        <Breakdown dim="browser" range={range} serviceId={serviceId} nonce={nonce} />
        <Breakdown dim="country" range={range} serviceId={serviceId} nonce={nonce} />
      </div>
    </div>
  );
}
