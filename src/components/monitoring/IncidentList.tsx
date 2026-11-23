import { CheckCircle2, ShieldAlert, AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/ui/States';
import { formatDateTime, formatSpan } from '@/utils/format';
import type { Incident } from '@/types';

export function IncidentList({ incidents, names }: { incidents: Incident[]; names?: Map<string, string> }) {
  if (incidents.length === 0) {
    return <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Сбоев не зафиксировано" hint="Инциденты появляются, когда проверка находит сайт недоступным или медленным." />;
  }
  return (
    <ul className="divide-y divide-line">
      {incidents.map((i) => {
        const open = !i.resolved_at;
        const down = i.severity === 'unavailable';
        return (
          <li key={i.id} className="flex gap-3 px-5 py-3">
            <span className="mt-0.5 shrink-0">
              {down ? <ShieldAlert className="h-4 w-4 text-bad" /> : <AlertTriangle className="h-4 w-4 text-warn" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">
                {names && <span>{names.get(i.service_id) ?? 'Сервис'} · </span>}
                {down ? 'Недоступен' : 'Медленный ответ'}
                {open && <span className="ml-2 rounded-full bg-bad/10 px-2 py-0.5 text-[11px] font-bold text-bad">продолжается</span>}
              </p>
              <p className="mt-0.5 break-words text-xs text-muted">
                {formatDateTime(i.started_at)} · длительность {formatSpan(i.started_at, i.resolved_at)}
                {i.http_status != null && ` · HTTP ${i.http_status}`}
                {i.error_message && ` · ${i.error_message}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
