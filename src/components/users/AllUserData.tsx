import { useState } from 'react';
import { Braces, ChevronDown, ChevronLeft, ChevronRight, Table2 } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { fetchUserTableRows, fetchUserTables } from '@/lib/supabase/api';
import { formatNumber } from '@/utils/format';
import type { UserTableInfo } from '@/types';
import { formatCell } from './dataFormat';

const PAGE = 50;

function TableBlock({ userId, info }: { userId: string; info: UserTableInfo }) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(false);
  const [page, setPage] = useState(0);
  const data = useAsync(
    () => (open ? fetchUserTableRows(userId, info.tbl, PAGE, page * PAGE) : Promise.resolve(null)),
    [open, page, userId, info.tbl],
  );

  const rows = data.data?.rows ?? [];
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const pages = Math.max(1, Math.ceil(info.row_count / PAGE));

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-elevated/50"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
        <code className="text-sm font-semibold">{info.tbl}</code>
        {info.depth > 0 && <span className="text-xs text-muted">через {info.via}</span>}
        <span className="ml-auto rounded-full bg-elevated px-2.5 py-0.5 text-xs font-bold tabular-nums text-muted">
          {formatNumber(info.row_count)}
        </span>
      </button>

      {open && (
        <div className="border-t border-line bg-bg/40">
          {data.error ? (
            <ErrorState message={data.error} onRetry={data.reload} />
          ) : data.loading && !data.data ? (
            <div className="p-4">
              <Skeleton className="h-24" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-5 py-2 text-xs text-muted">
                <span>
                  {data.data && data.data.hidden_columns.length > 0
                    ? `Скрыты защитные поля: ${data.data.hidden_columns.join(', ')}`
                    : 'Показаны все поля'}
                </span>
                <button className="btn !px-2.5 !py-1 !text-xs" onClick={() => setJson((j) => !j)}>
                  {json ? <Table2 className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
                  {json ? 'Таблица' : 'JSON'}
                </button>
              </div>

              {json ? (
                <pre className="max-h-[420px] overflow-auto px-5 pb-4 text-xs leading-relaxed text-muted">
                  {JSON.stringify(rows, null, 2)}
                </pre>
              ) : (
                <div className={`max-h-[420px] overflow-auto ${data.loading ? 'opacity-60' : ''}`}>
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface text-muted">
                      <tr>
                        {columns.map((c) => (
                          <th key={c} className="whitespace-nowrap border-b border-line px-3 py-2 font-semibold">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((r, i) => (
                        <tr key={i} className="align-top">
                          {columns.map((c) => (
                            <td key={c} className="max-w-[320px] break-words px-3 py-2" title={formatCell(r[c])}>
                              <span className="line-clamp-3">{formatCell(r[c])}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {info.row_count > PAGE && (
                <div className="flex items-center justify-between px-5 py-2 text-xs text-muted">
                  <span>
                    Страница {page + 1} из {pages}
                  </span>
                  <div className="flex gap-2">
                    <button className="btn !px-2 !py-1" disabled={page === 0 || data.loading} onClick={() => setPage((p) => p - 1)} aria-label="Назад">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button className="btn !px-2 !py-1" disabled={page + 1 >= pages || data.loading} onClick={() => setPage((p) => p + 1)} aria-label="Вперёд">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Все строки пользователя из всех таблиц БД. Список таблиц определяется на сервере автоматически,
 * поэтому новые таблицы и колонки появляются здесь сами.
 */
export function AllUserData({ userId }: { userId: string }) {
  const tables = useAsync(() => fetchUserTables(userId), [userId]);
  const [showEmpty, setShowEmpty] = useState(false);

  const all = tables.data ?? [];
  const filled = all.filter((t) => t.row_count > 0);
  const visible = showEmpty ? all : filled;
  const totalRows = filled.reduce((s, t) => s + t.row_count, 0);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-sm font-extrabold tracking-tight">Все данные в базе</h2>
          {tables.data && (
            <p className="mt-0.5 text-xs text-muted">
              Таблиц с данными: {filled.length} из {all.length} · строк: {formatNumber(totalRows)}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Показывать пустые таблицы
        </label>
      </div>

      {tables.error ? (
        <ErrorState
          message={`${tables.error}. Если ошибка про функцию cc_user_tables — примените миграцию 0005 в Supabase.`}
          onRetry={tables.reload}
        />
      ) : tables.loading ? (
        <div className="p-4">
          <Skeleton className="h-32" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState title="Данных в таблицах нет" hint="У пользователя пока нет ни одной строки в связанных таблицах." />
      ) : (
        <div>
          {visible.map((t) => (
            <TableBlock key={t.tbl} userId={userId} info={t} />
          ))}
        </div>
      )}
    </section>
  );
}
