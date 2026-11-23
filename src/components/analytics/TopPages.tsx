import { FileText } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { fetchTopPages } from '@/lib/supabase/api';
import { useServices } from '@/lib/ServicesProvider';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatNumber, type Range } from '@/utils/format';

interface Props {
  range: Range;
  serviceId: string | null;
  nonce: number;
}

export function TopPages({ range, serviceId, nonce }: Props) {
  const { rows } = useServices();
  const names = new Map(rows.map((r) => [r.service.id, r.service.name]));
  const { data, loading, error, reload } = useAsync(
    () => fetchTopPages(range.from, range.to, serviceId, 10),
    [range.from.getTime(), range.to.getTime(), serviceId, nonce],
  );

  return (
    <section className="card">
      <div className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-extrabold tracking-tight">Популярные страницы</h2>
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="Нет просмотров за период" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-semibold sm:px-5">Страница</th>
                <th className="px-3 py-2.5 text-right font-semibold">Просмотры</th>
                <th className="px-4 py-2.5 text-right font-semibold sm:px-5">Посетители</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((p) => (
                <tr key={`${p.service_id}:${p.page_path}`}>
                  <td className="max-w-[320px] px-4 py-2.5 sm:px-5">
                    <p className="truncate font-mono text-[13px]" title={p.page_path}>
                      {p.page_path}
                    </p>
                    {!serviceId && <p className="truncate text-xs text-muted">{names.get(p.service_id) ?? '—'}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatNumber(p.views)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted sm:px-5">{formatNumber(p.visitors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
