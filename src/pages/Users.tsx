import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, RefreshCw, ShieldCheck, UserPlus, Users as UsersIcon, UserCheck } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { PeriodPicker, useRangeState } from '@/components/ui/PeriodPicker';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchRegistrations, fetchUsersByService, fetchUsersSummary } from '@/lib/supabase/api';
import { formatBucket, formatNumber } from '@/utils/format';

export default function Users() {
  const { rows } = useServices();
  const { period, setPeriod, custom, setCustom, range, nonce, refresh } = useRangeState('30d');
  const summary = useAsync(fetchUsersSummary, [nonce]);
  const byService = useAsync(fetchUsersByService, [nonce]);
  const regs = useAsync(() => fetchRegistrations(range.from, range.to), [range.from.getTime(), range.to.getTime(), nonce]);

  const s = summary.data;
  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));
  const points = (regs.data ?? []).map((p) => ({ name: formatBucket(p.bucket, range.bucket), n: p.registrations }));
  const hasRegs = points.some((p) => p.n > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-3xl gap-3 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Здесь только агрегированные числа — без e-mail и персональных данных. «Посетители» (анонимные, раздел Analytics),
            «зарегистрированные» (аккаунты Supabase Auth) и «администраторы» учитываются раздельно. Привязка пользователя к
            сервису появляется, когда приложение вызывает <code className="text-fg">cc_register_service_user</code> (см. docs/connect-service.md).
          </p>
        </div>
        <button className="btn" onClick={refresh}><RefreshCw className="h-4 w-4" /> Обновить</button>
      </div>

      {summary.error ? (
        <div className="card"><ErrorState message={summary.error} onRetry={summary.reload} /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Зарегистрированных" value={s ? formatNumber(s.registered) : '—'} icon={UsersIcon} loading={summary.loading} hint="Без администраторов" />
          <StatCard label="Новых за 7 / 30 дней" value={s ? `${formatNumber(s.new_7d)} / ${formatNumber(s.new_30d)}` : '—'} icon={UserPlus} loading={summary.loading} />
          <StatCard label="Активных за 7 / 30 дней" value={s ? `${formatNumber(s.active_7d)} / ${formatNumber(s.active_30d)}` : '—'} icon={UserCheck} loading={summary.loading} hint="По последнему входу" />
          <StatCard label="Администраторов" value={s ? formatNumber(s.admins) : '—'} icon={ShieldCheck} loading={summary.loading} hint={s ? `В сервисах: ${formatNumber(s.in_services)}` : undefined} />
        </div>
      )}

      <section className="card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-tight">Регистрации</h2>
          <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        </div>
        <div className="h-60">
          {regs.loading ? <Skeleton className="h-full w-full" /> : regs.error ? (
            <ErrorState message={regs.error} onRetry={regs.reload} />
          ) : !hasRegs ? (
            <EmptyState title="Регистраций за период нет" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#252A34" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="name" stroke="#9299A7" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis stroke="#9299A7" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#161A21', border: '1px solid #252A34', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [v, 'Регистрации']} />
                <Bar dataKey="n" fill="#5B8DEF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-extrabold tracking-tight">По сервисам</h2>
        </div>
        {byService.loading ? <div className="p-4"><Skeleton className="h-24" /></div> : byService.error ? (
          <ErrorState message={byService.error} onRetry={byService.reload} />
        ) : !byService.data || byService.data.length === 0 ? (
          <EmptyState title="Привязок пользователей к сервисам пока нет" hint="Они появятся, когда приложения начнут вызывать cc_register_service_user после входа пользователя." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-semibold">Сервис</th>
                <th className="px-4 py-2.5 text-right font-semibold">Пользователей</th>
                <th className="px-4 py-2.5 text-right font-semibold">Новых за 30 дн</th>
                <th className="px-5 py-2.5 text-right font-semibold">Активных за 30 дн</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byService.data.map((r) => (
                <tr key={r.service_id}>
                  <td className="px-5 py-3 font-semibold">{names.get(r.service_id) ?? 'Сервис'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(r.users)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{formatNumber(r.new_30d)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted">{formatNumber(r.active_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
