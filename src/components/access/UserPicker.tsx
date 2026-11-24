import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { fetchUsersList } from '@/lib/supabase/api';
import type { UserListRow } from '@/types';
import { ROLE_LABEL } from './labels';

/** Поиск пользователя по e-mail, телефону, имени или ID — для выдачи доступа. */
export function UserPicker({ onPick }: { onPick: (u: UserListRow) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debounced.trim().length >= 2;
  const list = useAsync(
    () => (enabled ? fetchUsersList({ q: debounced, limit: 6, offset: 0, sort: 'email_asc' }) : Promise.resolve([])),
    [debounced, enabled],
  );

  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input !pl-9"
          placeholder="Найти пользователя: e-mail, телефон, имя"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {enabled && (
        <div className="overflow-hidden rounded-xl border border-line">
          {list.error ? (
            <p className="p-3 text-xs text-bad">{list.error}</p>
          ) : (list.data ?? []).length === 0 ? (
            <p className="p-3 text-xs text-muted">{list.loading ? 'Ищем…' : 'Никого не нашли. Пользователь должен сначала зарегистрироваться.'}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(list.data ?? []).map((u) => (
                <li key={u.user_id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-elevated/60"
                    onClick={() => onPick(u)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{u.display_name || u.email || u.phone || u.user_id}</span>
                      <span className="block truncate text-xs text-muted">{u.email ?? u.phone ?? '—'}</span>
                    </span>
                    {u.role && <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold text-muted">{ROLE_LABEL[u.role]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
