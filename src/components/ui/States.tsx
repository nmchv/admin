import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-elevated ${className}`} />;
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-muted">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-bad" />
      <p className="text-sm font-semibold">Не удалось загрузить данные</p>
      <p className="max-w-md break-words text-xs leading-relaxed text-muted">{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Повторить
        </button>
      )}
    </div>
  );
}
