import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { fetchUsersList } from '@/lib/supabase/api';
import { ROLE_LABEL } from '@/components/access/labels';
import { formatFullDateTime, formatNumber, formatRelative } from '@/utils/format';

const PAGE = 25;

const SORTS: { value: string; label: string }[] = [
  { value: 'created_desc', label: 'Сначала новые' },
  { value: 'created_asc', label: 'Сначала старые' },
  { value: 'seen_desc', label: 'По последнему входу' },
  { value: 'email_asc', label: 'По e-mail' },
];

/** Список всех пользователей с поиском. Клик по строке открывает полную карточку. */
export function UsersTable() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState('created_desc');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useAsync(
    () => fetchUsersList({ q: debounced, limit: PAGE, offset: page * PAGE, sort }),
    [debounced, sort, page],
  );

  const rows = list.data ?? [];
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <h2 className="mr-auto text-sm font-extrabold tracking-tight">
          Пользователи{list.data ? <span className="ml-2 font-semibold text-muted">{formatNumber(total)}</span> : null}
        </h2>
        <label className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input !pl-9"
            placeholder="E-mail, телефон, имя, логин или ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          className="input !w-auto"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
          aria-label="Сортировка"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {list.error ? (
        <ErrorState
          message={`${list.error}. Если ошибка про функцию cc_users_list — примените миграцию 0005 в Supabase.`}
          onRetry={list.reload}
        />
      ) : list.loading && !list.data ? (
        <div className="p-4">
          <Skeleton className="h-40" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={debounced ? 'Никого не нашли' : 'Пользователей пока нет'} hint={debounced ? 'Попробуйте другой запрос.' : undefined} />
      ) : (
        <div className={`overflow-x-auto ${list.loading ? 'opacity-60' : ''}`}>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-semibold">Пользователь</th>
                <th className="px-4 py-2.5 font-semibold">Телефон</th>
                <th className="px-4 py-2.5 font-semibold">Сервисы</th>
                <th className="px-4 py-2.5 font-semibold">Регистрация</th>
                <th className="px-5 py-2.5 font-semibold">Последний вход</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((u) => (
                <tr
                  key={u.user_id}
                  tabIndex={0}
                  className="cursor-pointer transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60 focus-visible:outline-none"
                  onClick={() => navigate(`/users/${u.user_id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/users/${u.user_id}`)}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-elevated text-xs font-extrabold text-accent">
                        {(u.display_name || u.email || '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span className="truncate">{u.display_name || u.username || u.email || 'Без имени'}</span>
                          {u.is_admin && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Администратор" />}
                          {u.is_banned && <Ban className="h-3.5 w-3.5 shrink-0 text-bad" aria-label="Заблокирован" />}
                          {u.is_super_admin && <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">супер</span>}
                          {u.role && <span className="shrink-0 rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-bold text-muted">{ROLE_LABEL[u.role]}</span>}
                        </div>
                        <div className="truncate text-xs text-muted">{u.email ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    {u.services.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.services.map((s) => (
                          <span key={s} className="rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold text-muted">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatFullDateTime(u.created_at)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted">
                    {u.last_sign_in_at ? formatRelative(u.last_sign_in_at) : 'не входил'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
          <span>
            Страница {page + 1} из {pages}
          </span>
          <div className="flex gap-2">
            <button className="btn !px-2.5 !py-1.5" disabled={page === 0 || list.loading} onClick={() => setPage((p) => p - 1)} aria-label="Назад">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="btn !px-2.5 !py-1.5" disabled={page + 1 >= pages || list.loading} onClick={() => setPage((p) => p + 1)} aria-label="Вперёд">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
