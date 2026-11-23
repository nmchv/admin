import { useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchActivity, fetchAdmins, fetchLogs } from '@/lib/supabase/api';
import { formatFullDateTime } from '@/utils/format';
import type { ActivityRow, LogRow } from '@/types';

const PAGE = 25;
const CATS: { key: LogRow['category']; label: string }[] = [
  { key: 'admin', label: 'Действия админов' },
  { key: 'maintenance', label: 'Обслуживание' },
  { key: 'monitoring', label: 'Мониторинг' },
  { key: 'security', label: 'Безопасность' },
  { key: 'system', label: 'Система' },
  { key: 'analytics', label: 'Аналитика' },
];
const catLabel = (k: string) => CATS.find((c) => c.key === k)?.label ?? k;
const catTone: Record<string, string> = {
  admin: 'bg-accent/10 text-accent',
  maintenance: 'bg-maint/10 text-maint',
  monitoring: 'bg-ok/10 text-ok',
  security: 'bg-warn/10 text-warn',
  system: 'bg-idle/10 text-muted',
  analytics: 'bg-idle/10 text-muted',
};

const dayStart = (v: string) => (v ? new Date(`${v}T00:00:00`) : null);
const dayEnd = (v: string) => (v ? new Date(new Date(`${v}T00:00:00`).getTime() + 86_400_000) : null);

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
      <span>Всего: {total}</span>
      <div className="flex items-center gap-2">
        <button className="btn !px-2" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Назад"><ChevronLeft className="h-4 w-4" /></button>
        <span className="tabular-nums">{page + 1} / {pages}</span>
        <button className="btn !px-2" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Вперёд"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-xl border border-line bg-bg p-3 text-xs leading-relaxed">
      {value == null ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EventsTab() {
  const { rows } = useServices();
  const [cats, setCats] = useState<string[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<LogRow | null>(null);
  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));

  const dep = [cats.join(','), serviceId, qApplied, from, to, asc, page];
  const { data, loading, error, reload } = useAsync(
    () => fetchLogs({ categories: cats, serviceId: serviceId || null, q: qApplied, from: dayStart(from), to: dayEnd(to), asc, page, pageSize: PAGE }),
    dep,
  );
  const reset = () => setPage(0);
  const toggle = (k: string) => {
    setCats((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
    reset();
  };

  return (
    <>
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => toggle(c.key)}
              aria-pressed={cats.includes(c.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                cats.includes(c.key) ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="relative min-w-[200px] flex-1" onSubmit={(e) => { e.preventDefault(); setQApplied(q); reset(); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" placeholder="Поиск по тексту события" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />
          </form>
          <select className="input !w-auto" value={serviceId} onChange={(e) => { setServiceId(e.target.value); reset(); }} aria-label="Сервис">
            <option value="">Все сервисы</option>
            {rows.map((r) => <option key={r.service.id} value={r.service.id}>{r.service.name}</option>)}
          </select>
          <input type="date" className="input !w-auto" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} aria-label="С даты" />
          <input type="date" className="input !w-auto" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} aria-label="По дату" />
          <select className="input !w-auto" value={asc ? 'asc' : 'desc'} onChange={(e) => { setAsc(e.target.value === 'asc'); reset(); }} aria-label="Порядок">
            <option value="desc">Сначала новые</option>
            <option value="asc">Сначала старые</option>
          </select>
          <button className="btn" onClick={reload}><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      <section className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Событий не найдено" hint="Измените фильтры или период." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {data.rows.map((l) => (
                <li key={l.id}>
                  <button className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-elevated/40" onClick={() => setOpen(l)}>
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${catTone[l.category] ?? ''}`}>{catLabel(l.category)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm leading-snug">{l.message}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {formatFullDateTime(l.created_at)}{l.service_id && ` · ${names.get(l.service_id) ?? 'сервис'}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </section>

      {open && (
        <Modal title="Событие" onClose={() => setOpen(null)} footer={<button className="btn" onClick={() => setOpen(null)}>Закрыть</button>}>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs font-semibold text-muted">Категория</dt><dd>{catLabel(open.category)}</dd></div>
            <div><dt className="text-xs font-semibold text-muted">Время</dt><dd>{formatFullDateTime(open.created_at)}</dd></div>
            {open.service_id && <div><dt className="text-xs font-semibold text-muted">Сервис</dt><dd>{names.get(open.service_id) ?? open.service_id}</dd></div>}
            <div><dt className="text-xs font-semibold text-muted">Сообщение</dt><dd className="break-words">{open.message}</dd></div>
            <div><dt className="mb-1 text-xs font-semibold text-muted">Метаданные</dt><dd><JsonView value={open.metadata} /></dd></div>
          </dl>
        </Modal>
      )}
    </>
  );
}

const ACTIONS = [
  { prefix: '', label: 'Все действия' },
  { prefix: 'maintenance', label: 'Обслуживание' },
  { prefix: 'service', label: 'Сервисы' },
  { prefix: 'setting', label: 'Настройки' },
  { prefix: 'admin', label: 'Администраторы' },
  { prefix: 'monitoring', label: 'Токен мониторинга' },
  { prefix: 'login', label: 'Входы' },
];

function ActivityTab() {
  const { rows } = useServices();
  const admins = useAsync(fetchAdmins, []);
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ActivityRow | null>(null);
  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));
  const who = new Map((admins.data ?? []).map((a) => [a.id, a.email]));

  const { data, loading, error, reload } = useAsync(
    () => fetchActivity({ from: dayStart(from), to: dayEnd(to), actionPrefix: prefix || null, asc, page, pageSize: PAGE }),
    [prefix, from, to, asc, page],
  );
  const reset = () => setPage(0);

  return (
    <>
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <select className="input !w-auto" value={prefix} onChange={(e) => { setPrefix(e.target.value); reset(); }} aria-label="Тип действия">
          {ACTIONS.map((a) => <option key={a.prefix} value={a.prefix}>{a.label}</option>)}
        </select>
        <input type="date" className="input !w-auto" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} aria-label="С даты" />
        <input type="date" className="input !w-auto" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} aria-label="По дату" />
        <select className="input !w-auto" value={asc ? 'asc' : 'desc'} onChange={(e) => { setAsc(e.target.value === 'asc'); reset(); }} aria-label="Порядок">
          <option value="desc">Сначала новые</option>
          <option value="asc">Сначала старые</option>
        </select>
        <button className="btn" onClick={reload}><RefreshCw className="h-4 w-4" /></button>
      </div>

      <section className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title="Действий не найдено" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {data.rows.map((a) => (
                <li key={a.id}>
                  <button className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-elevated/40" onClick={() => setOpen(a)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm">{a.action}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {formatFullDateTime(a.created_at)} · {a.admin_id ? who.get(a.admin_id) ?? 'администратор' : 'система'}
                        {a.target_service_id && ` · ${names.get(a.target_service_id) ?? 'сервис'}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </section>

      {open && (
        <Modal title="Действие администратора" onClose={() => setOpen(null)} footer={<button className="btn" onClick={() => setOpen(null)}>Закрыть</button>}>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs font-semibold text-muted">Действие</dt><dd className="font-mono">{open.action}</dd></div>
            <div><dt className="text-xs font-semibold text-muted">Время</dt><dd>{formatFullDateTime(open.created_at)}</dd></div>
            <div><dt className="text-xs font-semibold text-muted">Администратор</dt><dd>{open.admin_id ? who.get(open.admin_id) ?? open.admin_id : '—'}</dd></div>
            <div><dt className="mb-1 text-xs font-semibold text-muted">Детали</dt><dd><JsonView value={open.details} /></dd></div>
          </dl>
        </Modal>
      )}
    </>
  );
}

export default function Logs() {
  const [tab, setTab] = useState<'events' | 'activity'>('events');
  return (
    <div className="space-y-4">
      <div className="flex w-fit rounded-xl border border-line bg-surface p-0.5" role="tablist">
        {([['events', 'События системы'], ['activity', 'Действия администраторов']] as const).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-[10px] px-4 py-1.5 text-xs font-semibold ${tab === k ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'events' ? <EventsTab /> : <ActivityTab />}
    </div>
  );
}
