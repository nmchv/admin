import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/States';

interface Props {
  label: string;
  value: string | null;
  icon: LucideIcon;
  hint?: string;
  /** % к предыдущему периоду; null — нет данных для сравнения; undefined — сравнение не применимо. */
  delta?: number | null;
  loading?: boolean;
  unavailable?: boolean;
  tone?: string;
}

export function StatCard({ label, value, icon: Icon, hint, delta, loading, unavailable, tone = 'text-muted' }: Props) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>

      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : unavailable || value === null ? (
        <span className="text-2xl font-extrabold tracking-tight text-muted">—</span>
      ) : (
        <span className="text-2xl font-extrabold tabular-nums tracking-tight">{value}</span>
      )}

      <div className="flex items-center gap-2 text-xs text-muted">
        {!loading && !unavailable && delta !== undefined && delta !== null && (
          <span
            className={`inline-flex items-center gap-0.5 font-bold ${delta >= 0 ? 'text-ok' : 'text-bad'}`}
          >
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className="truncate">
          {unavailable ? 'Данные недоступны' : delta === null && !loading ? 'Нет данных за прошлый период' : hint}
        </span>
      </div>
    </div>
  );
}
