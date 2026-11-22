import { Link } from 'react-router-dom';
import { ExternalLink, Github, Server, Users } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatNumber, formatRelative } from '@/utils/format';
import type { ServiceRow } from '@/types';

export function ServiceCard({ row }: { row: ServiceRow }) {
  const { service, status, maintenance, lastCheckedAt, visitors24h, updatedAt } = row;

  return (
    <article className="card flex flex-col gap-4 p-4 transition-colors hover:border-[#343b49]">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-muted">
          <Server className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to={`/services/${service.slug}`}
            className="block truncate text-sm font-extrabold tracking-tight hover:text-accent"
          >
            {service.name}
          </Link>
          <p className="truncate font-mono text-xs text-muted">{service.slug}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {maintenance && (
        <p className="rounded-lg bg-maint/10 px-3 py-2 text-xs leading-snug text-maint">
          {maintenance.source === 'global' ? 'Глобальное обслуживание' : 'Индивидуальное обслуживание'}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted">Посетители за сутки</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-bold tabular-nums">
            <Users className="h-3 w-3 text-muted" />
            {formatNumber(visitors24h)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Проверка доступности</dt>
          <dd className="mt-0.5 font-bold">{formatRelative(lastCheckedAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Обновлён</dt>
          <dd className="mt-0.5 font-bold">{formatRelative(updatedAt)}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
        <Link to={`/services/${service.slug}`} className="btn flex-1 !py-1.5 text-xs">
          Управление
        </Link>
        {service.url ? (
          <a
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn !px-2.5 !py-1.5"
            title="Открыть сайт"
            aria-label="Открыть сайт"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="btn !px-2.5 !py-1.5 opacity-40" title="URL не указан" aria-label="URL не указан">
            <ExternalLink className="h-3.5 w-3.5" />
          </span>
        )}
        {service.github_repository ? (
          <a
            href={`https://github.com/${service.github_repository}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn !px-2.5 !py-1.5"
            title="GitHub-репозиторий"
            aria-label="GitHub-репозиторий"
          >
            <Github className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="btn !px-2.5 !py-1.5 opacity-40" title="Репозиторий не указан" aria-label="Репозиторий не указан">
            <Github className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </article>
  );
}
