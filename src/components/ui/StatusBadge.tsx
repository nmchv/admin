import { STATUS_META } from '@/utils/status';
import type { ServiceStatus } from '@/types';

export function StatusDot({ status, pulse = false }: { status: ServiceStatus; pulse?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && status !== 'unknown' && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${m.dot}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${m.dot}`} />
    </span>
  );
}

export function StatusBadge({ status }: { status: ServiceStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${m.bg} ${m.text}`}
    >
      <StatusDot status={status} />
      {m.label}
    </span>
  );
}
