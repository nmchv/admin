import { ScrollText } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { fetchRecentLogs } from '@/lib/supabase/api';
import { useServices } from '@/lib/ServicesProvider';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatDateTime } from '@/utils/format';

const CATEGORY_STYLE: Record<string, string> = {
  admin: 'text-accent bg-accent/10',
  maintenance: 'text-maint bg-maint/10',
  system: 'text-muted bg-idle/10',
  security: 'text-warn bg-warn/10',
  monitoring: 'text-ok bg-ok/10',
  analytics: 'text-muted bg-idle/10',
};

export function RecentEvents() {
  const { data, loading, error, reload } = useAsync(() => fetchRecentLogs(10), []);
  const { rows } = useServices();
  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));

  return (
    <section className="card">
      <div className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-extrabold tracking-tight">Последние события</h2>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-6 w-6" />}
          title="Событий пока нет"
          hint="Здесь появятся входы администратора, изменения режима обслуживания и результаты проверок."
        />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <span
                className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                  CATEGORY_STYLE[e.category] ?? CATEGORY_STYLE.system
                }`}
              >
                {e.category}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm leading-snug">{e.message}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatDateTime(e.created_at)}
                  {e.service_id && names.get(e.service_id) ? ` · ${names.get(e.service_id)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
