import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, Award, Ban, ClipboardCheck, Clock, ListChecks, MousePointerClick, ShieldCheck, Target } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { UserAccess } from '@/components/access/UserAccess';
import { AllUserData } from '@/components/users/AllUserData';
import { formatCell, isIso, labelOf } from '@/components/users/dataFormat';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/lib/SettingsProvider';
import { fetchUserCharts, fetchUserOverview } from '@/lib/supabase/api';
import { formatNumber, formatRelative } from '@/utils/format';
import type { UserCharts } from '@/types';

const TOOLTIP = { background: '#161A21', border: '1px solid #252A34', borderRadius: 12, fontSize: 12 } as const;
const AXIS = { stroke: '#9299A7', fontSize: 11, tickLine: false, axisLine: false } as const;
const PERIODS = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 365, label: 'Год' },
];

function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChartCard({ title, children, empty }: { title: string; children: ReactNode; empty: boolean }) {
  return (
    <section className="card p-4 sm:p-5">
      <h3 className="mb-3 text-sm font-extrabold tracking-tight">{title}</h3>
      <div className="h-56">
        {empty ? <EmptyState title="Данных за период нет" /> : children}
      </div>
    </section>
  );
}

/** Дни без активности тоже должны быть на оси: заполняем нулями. */
function fillDays(data: UserCharts['activity'], days: number, tz: string) {
  const fmt = (d: Date) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    } catch {
      return new Intl.DateTimeFormat('en-CA').format(d);
    }
  };
  const byDay = new Map(data.map((d) => [d.day, Number(d.n)]));
  const out: { day: string; label: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = fmt(new Date(Date.now() - i * 86_400_000));
    out.push({ day, label: `${day.slice(8, 10)}.${day.slice(5, 7)}`, n: byDay.get(day) ?? 0 });
  }
  return out;
}

export default function UserDetail() {
  const { id = '' } = useParams();
  const settings = useSettings();
  const tz = settings.get('general.timezone');
  const [days, setDays] = useState(90);

  // Просмотр карточки пишется в журнал один раз; перезагрузки после изменений — без записи.
  const loggedFor = useRef<string | null>(null);
  const overview = useAsync(async () => {
    const log = loggedFor.current !== id;
    const res = await fetchUserOverview(id, log);
    loggedFor.current = id;
    return res;
  }, [id]);
  const charts = useAsync(() => fetchUserCharts(id, days, tz), [id, days, tz]);

  const c = charts.data;
  const activity = useMemo(() => (c ? fillDays(c.activity, Math.min(days, 365), tz) : []), [c, days, tz]);
  const attempts = (c?.attempts ?? []).map((a) => ({
    ...a,
    label: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(a.at)),
    pct: a.percentage === null ? null : Number(a.percentage),
  }));
  const progress = (c?.progress ?? []).map((p) => ({
    exam: p.exam_id,
    'Верных': Number(p.correct),
    'Попыток': Number(p.attempts),
  }));

  const o = overview.data;
  const a = o?.auth;
  const title = (o?.profile?.display_name as string) || (o?.profile?.username as string) || a?.email || 'Пользователь';

  return (
    <div className="space-y-6">
      <Link to="/users" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Все пользователи
      </Link>

      {overview.error ? (
        <div className="card">
          <ErrorState
            message={`${overview.error}. Если ошибка про функцию cc_user_overview — примените миграцию 0005 в Supabase.`}
            onRetry={overview.reload}
          />
        </div>
      ) : !o || !a ? (
        <Skeleton className="h-56" />
      ) : (
        <section className="card p-5">
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-line bg-elevated text-xl font-extrabold text-accent">
              {title.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-extrabold tracking-tight">{title}</h2>
              <p className="truncate text-sm text-muted">{a.email ?? a.phone ?? a.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {o.is_admin && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                  <ShieldCheck className="h-3.5 w-3.5" /> Администратор
                </span>
              )}
              {a.banned_until && new Date(a.banned_until) > new Date() && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-bad/10 px-2.5 py-1 text-xs font-semibold text-bad">
                  <Ban className="h-3.5 w-3.5" /> Заблокирован
                </span>
              )}
              {a.is_anonymous && <span className="rounded-full bg-elevated px-2.5 py-1 text-xs font-semibold text-muted">Анонимный</span>}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted">Аккаунт</h3>
              <Kv
                rows={[
                  ['E-mail', a.email ?? '—'],
                  ['E-mail подтверждён', a.email_confirmed_at ? formatCell(a.email_confirmed_at) : 'нет'],
                  ['Телефон', a.phone ?? '—'],
                  ['Телефон подтверждён', a.phone_confirmed_at ? formatCell(a.phone_confirmed_at) : 'нет'],
                  ['Регистрация', formatCell(a.created_at)],
                  ['Последний вход', a.last_sign_in_at ? `${formatCell(a.last_sign_in_at)} (${formatRelative(a.last_sign_in_at)})` : 'не входил'],
                  ['Способы входа', a.providers?.join(', ') || '—'],
                  ['ID', <code key="id" className="text-xs">{a.id}</code>],
                ]}
              />
            </div>
            <div>
              <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted">Профиль и дополнительные данные</h3>
              {Object.keys(o.profile ?? {}).length + Object.keys(a.user_metadata).length === 0 ? (
                <p className="text-sm text-muted">Профиль не заполнен.</p>
              ) : (
                <Kv
                  rows={[
                    ...Object.entries(o.profile ?? {})
                      .filter(([k]) => k !== 'id')
                      .map(([k, v]): [string, ReactNode] => [labelOf(k), formatCell(v)]),
                    ...Object.entries(a.user_metadata).map(([k, v]): [string, ReactNode] => [
                      labelOf(k),
                      isIso(v) ? formatCell(v) : formatCell(v),
                    ]),
                  ]}
                />
              )}
            </div>
          </div>

        </section>
      )}

      {o && <UserAccess overview={o} onChanged={overview.reload} />}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold tracking-tight">Активность и результаты</h2>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              className={`btn !px-3 !py-1.5 !text-xs ${days === p.days ? '!border-accent/60 !text-accent' : ''}`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {charts.error ? (
        <div className="card">
          <ErrorState
            message={`${charts.error}. Если ошибка про функцию cc_user_charts — примените миграцию 0005 в Supabase.`}
            onRetry={charts.reload}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Попыток" value={c ? formatNumber(c.totals.attempts) : null} icon={ClipboardCheck} loading={charts.loading} hint={c ? `Завершено: ${c.totals.attempts_done}` : undefined} />
            <StatCard label="Средний балл" value={c ? (c.totals.avg_percentage === null ? '—' : `${c.totals.avg_percentage}%`) : null} icon={Target} loading={charts.loading} />
            <StatCard label="Лучший балл" value={c ? (c.totals.best_percentage === null ? '—' : `${c.totals.best_percentage}%`) : null} icon={Award} loading={charts.loading} />
            <StatCard label="События" value={c ? formatNumber(c.totals.events) : null} icon={MousePointerClick} loading={charts.loading} />
            <StatCard label="Достижения / цели" value={c ? `${c.totals.achievements} / ${c.totals.goals}` : null} icon={ListChecks} loading={charts.loading} />
            <StatCard label="Активность" value={c ? (c.totals.last_activity ? formatRelative(c.totals.last_activity) : '—') : null} icon={Clock} loading={charts.loading} hint="Последнее действие" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Активность по дням" empty={!charts.loading && !activity.some((d) => d.n > 0)}>
              {charts.loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activity} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#252A34" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="label" {...AXIS} minTickGap={28} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={TOOLTIP} formatter={(v: number) => [v, 'Действий']} labelFormatter={(l) => `Дата: ${l}`} />
                    <Bar dataKey="n" fill="#5B8DEF" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Результаты попыток, %" empty={!charts.loading && attempts.length === 0}>
              {charts.loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={attempts} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#252A34" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="label" {...AXIS} minTickGap={24} />
                    <YAxis {...AXIS} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      formatter={(v: number) => [`${v}%`, 'Результат']}
                      labelFormatter={(_l, p) => {
                        const d = p?.[0]?.payload as (typeof attempts)[number] | undefined;
                        return d ? `${d.exam_id} · ${d.mode} · ${d.score ?? '—'}/${d.max_score ?? '—'}` : '';
                      }}
                    />
                    <Line type="monotone" dataKey="pct" stroke="#3DBE7A" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="События по сервисам" empty={!charts.loading && (c?.by_project.length ?? 0) === 0}>
              {charts.loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={c?.by_project.map((p) => ({ ...p, n: Number(p.n) }))} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#252A34" strokeDasharray="3 6" horizontal={false} />
                    <XAxis type="number" {...AXIS} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" {...AXIS} width={110} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={TOOLTIP} formatter={(v: number) => [v, 'Событий']} />
                    <Bar dataKey="n" fill="#5BA8F5" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Типы событий" empty={!charts.loading && (c?.by_event.length ?? 0) === 0}>
              {charts.loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={c?.by_event.map((e) => ({ ...e, n: Number(e.n) }))} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#252A34" strokeDasharray="3 6" horizontal={false} />
                    <XAxis type="number" {...AXIS} allowDecimals={false} />
                    <YAxis type="category" dataKey="event_type" {...AXIS} width={110} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={TOOLTIP} formatter={(v: number) => [v, 'Событий']} />
                    <Bar dataKey="n" fill="#E3B341" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {(charts.loading || progress.length > 0) && (
            <ChartCard title="Прогресс по заданиям (по экзаменам)" empty={false}>
              {charts.loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={progress} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#252A34" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="exam" {...AXIS} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Попыток" fill="#5B8DEF" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Верных" fill="#3DBE7A" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          )}
        </>
      )}

      <AllUserData userId={id} />
    </div>
  );
}
