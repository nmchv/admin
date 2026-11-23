import { BarChart3 } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatNumber } from '@/utils/format';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  hint?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  items: BarItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyHint?: string;
}

/** Горизонтальный список с долями — для источников, устройств, ОС, браузеров, стран, сервисов. */
export function BarList({ title, subtitle, items, loading, error, onRetry, emptyHint }: Props) {
  const total = (items ?? []).reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...(items ?? []).map((i) => i.value));

  return (
    <section className="card">
      <div className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-extrabold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {loading ? (
        <div className="space-y-3 p-4 sm:p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !items || items.length === 0 ? (
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Нет данных за период" hint={emptyHint} />
      ) : (
        <ul className="space-y-3.5 p-4 sm:p-5">
          {items.map((i) => (
            <li key={i.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold" title={i.label}>
                  {i.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  <b className="font-bold text-fg">{formatNumber(i.value)}</b>
                  {total > 0 && <span className="ml-2 text-xs">{Math.round((i.value / total) * 100)}%</span>}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-accent/80" style={{ width: `${(i.value / max) * 100}%` }} />
              </div>
              {i.hint && <p className="mt-1 text-xs text-muted">{i.hint}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
