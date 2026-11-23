import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, RefreshCw } from 'lucide-react';
import { IncidentList } from '@/components/monitoring/IncidentList';
import { ResponseChart } from '@/components/monitoring/ResponseChart';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge, StatusDot } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchIncidents, fetchInfra, fetchUptime } from '@/lib/supabase/api';
import { formatDateTime, formatRelative } from '@/utils/format';
import type { InfraRow, ServiceStatus } from '@/types';

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(v >= 99.995 || v === 0 ? 0 : 2)}%`);
const tone = (v: number | null) => (v == null ? 'text-muted' : v >= 99.5 ? 'text-ok' : v >= 95 ? 'text-warn' : 'text-bad');

const INFRA_NAMES: Record<InfraRow['component'], [string, string]> = {
  database: ['База данных', 'Запрос к PostgREST (REST-эндпоинт проекта)'],
  api: ['API', 'Ответ шлюза Supabase'],
  auth: ['Auth', 'Эндпоинт /auth/v1/health'],
};

function infraStatus(s: InfraRow['status']): ServiceStatus {
  return s ?? 'unknown';
}

export default function Monitoring() {
  const toast = useToast();
  const { rows, loading: svcLoading, error: svcError, reload } = useServices();
  const uptime = useAsync(fetchUptime, []);
  const infra = useAsync(fetchInfra, []);
  const incidents = useAsync(() => fetchIncidents(null, 50), []);
  const [chartId, setChartId] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));
  const up = new Map((uptime.data ?? []).map((u) => [u.service_id, u]));
  const selected = chartId ?? rows[0]?.service.id ?? null;

  const refresh = () => {
    reload();
    uptime.reload();
    infra.reload();
    incidents.reload();
    toast('success', 'Данные обновлены');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-3xl gap-3 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Проверки выполняет GitHub Actions по расписанию (не чаще раза в 5 минут, возможны задержки). Это HTTP-запросы к
            публичным адресам сайтов — они показывают доступность, но не заменяют полный мониторинг серверов. Uptime — доля
            проверок, не обнаруживших недоступность.
          </p>
        </div>
        <button className="btn" onClick={refresh}>
          <RefreshCw className="h-4 w-4" /> Обновить
        </button>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-extrabold tracking-tight">Доступность сервисов</h2>
        </div>
        {svcLoading || uptime.loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : svcError || uptime.error ? (
          <ErrorState message={(svcError ?? uptime.error) as string} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState title="Сервисов нет" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  {['Сервис', 'Статус', '24 ч', '7 дн', '30 дн', 'Ответ (ср.)', 'Последняя проверка', 'Последний сбой'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const u = up.get(r.service.id);
                  return (
                    <tr key={r.service.id} className="hover:bg-elevated/40">
                      <td className="px-4 py-3 font-semibold">
                        <Link to={`/services/${r.service.slug}`} className="hover:text-accent">{r.service.name}</Link>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className={`px-4 py-3 font-semibold tabular-nums ${tone(u?.uptime_24h ?? null)}`}>{pct(u?.uptime_24h ?? null)}</td>
                      <td className={`px-4 py-3 font-semibold tabular-nums ${tone(u?.uptime_7d ?? null)}`}>{pct(u?.uptime_7d ?? null)}</td>
                      <td className={`px-4 py-3 font-semibold tabular-nums ${tone(u?.uptime_30d ?? null)}`}>{pct(u?.uptime_30d ?? null)}</td>
                      <td className="px-4 py-3 tabular-nums text-muted">{u?.avg_response_ms != null ? `${Math.round(u.avg_response_ms)} мс` : '—'}</td>
                      <td className="px-4 py-3 text-muted">{formatRelative(u?.last_check_at ?? null)}</td>
                      <td className="px-4 py-3 text-muted">
                        {u?.open_incident ? <span className="font-semibold text-bad">идёт сейчас</span> : u?.last_incident_at ? formatDateTime(u.last_incident_at) : 'нет'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-tight">Время ответа</h2>
          <div className="flex flex-wrap gap-2">
            <select className="input !w-auto" value={selected ?? ''} onChange={(e) => setChartId(e.target.value)} aria-label="Сервис">
              {rows.map((r) => <option key={r.service.id} value={r.service.id}>{r.service.name}</option>)}
            </select>
            <select className="input !w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Период">
              <option value={24}>24 часа</option>
              <option value={168}>7 дней</option>
              <option value={720}>30 дней</option>
            </select>
          </div>
        </div>
        {selected && <ResponseChart serviceId={selected} hours={hours} />}
      </section>

      <section className="card">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-extrabold tracking-tight">Инфраструктура Supabase</h2>
          <p className="mt-0.5 text-xs text-muted">
            Проверяется доступность эндпоинтов проекта из монитора. Нагрузка, диск и память сервера через публичный API недоступны — их смотрите в панели Supabase.
          </p>
        </div>
        {infra.loading ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : infra.error ? (
          <ErrorState message={infra.error} onRetry={infra.reload} />
        ) : (
          <div className="grid gap-px bg-line sm:grid-cols-3">
            {(['database', 'api', 'auth'] as const).map((c) => {
              const r = infra.data?.find((x) => x.component === c);
              const [name, hint] = INFRA_NAMES[c];
              return (
                <div key={c} className="bg-surface p-5">
                  <div className="flex items-center gap-2">
                    <StatusDot status={infraStatus(r?.status ?? null)} />
                    <h3 className="text-sm font-extrabold">{name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted">{hint}</p>
                  {r && r.checked_at ? (
                    <dl className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between"><dt className="text-muted">Ответ</dt><dd className="font-semibold tabular-nums">{r.response_time != null ? `${r.response_time} мс` : '—'}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Среднее за 24 ч</dt><dd className="font-semibold tabular-nums">{r.avg_ms_24h != null ? `${Math.round(r.avg_ms_24h)} мс` : '—'}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Сбоев за 24 ч</dt><dd className="font-semibold tabular-nums">{r.failures_24h} из {r.checks_24h}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Проверено</dt><dd className="font-semibold">{formatRelative(r.checked_at)}</dd></div>
                      {r.error_message && <p className="break-words pt-1 text-bad">{r.error_message}</p>}
                    </dl>
                  ) : (
                    <p className="mt-3 text-xs text-muted">Нет данных — монитор ещё не запускался.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-extrabold tracking-tight">История сбоев</h2>
        </div>
        {incidents.loading ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : incidents.error ? (
          <ErrorState message={incidents.error} onRetry={incidents.reload} />
        ) : (
          <IncidentList incidents={incidents.data ?? []} names={names} />
        )}
      </section>
    </div>
  );
}
