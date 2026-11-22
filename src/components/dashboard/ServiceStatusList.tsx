import { Link } from 'react-router-dom';
import { ChevronRight, Server } from 'lucide-react';
import { useServices } from '@/lib/ServicesProvider';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatNumber, formatRelative } from '@/utils/format';

export function ServiceStatusList() {
  const { rows, loading, error, reload, visitorsError } = useServices();

  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-extrabold tracking-tight">Статус сервисов</h2>
        <Link to="/services" className="text-xs font-semibold text-accent hover:underline">
          Все сервисы
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Сервисы не зарегистрированы"
          hint="Примените миграцию supabase/migrations/0001_control_center_init.sql — она добавит восемь начальных сервисов."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ service, status, lastCheckedAt, visitors24h }) => (
            <li key={service.id}>
              <Link
                to={`/services/${service.slug}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/50 sm:px-5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-muted">
                  <Server className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{service.name}</p>
                  <p className="truncate text-xs text-muted">
                    {visitorsError ? 'посетители: н/д' : `${formatNumber(visitors24h)} за сутки`} ·{' '}
                    {formatRelative(lastCheckedAt)}
                  </p>
                </div>
                <StatusBadge status={status} />
                <ChevronRight className="hidden h-4 w-4 text-muted sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
