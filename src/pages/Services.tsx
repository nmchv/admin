import { useMemo, useState } from 'react';
import { Plus, Search, SearchX } from 'lucide-react';
import { GlobalMaintenance } from '@/components/services/GlobalMaintenance';
import { ServiceCard } from '@/components/services/ServiceCard';
import { ServiceFormDialog } from '@/components/services/ServiceFormDialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useServices } from '@/lib/ServicesProvider';
import type { ServiceStatus } from '@/types';

type SortKey = 'name' | 'status' | 'visitors' | 'updated';

// Порядок «сначала проблемные».
const STATUS_ORDER: Record<ServiceStatus, number> = {
  unavailable: 0,
  degraded: 1,
  maintenance: 2,
  unknown: 3,
  operational: 4,
};

export default function Services() {
  const { rows, loading, error, reload } = useServices();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ServiceStatus | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (!q ||
          r.service.name.toLowerCase().includes(q) ||
          r.service.slug.toLowerCase().includes(q) ||
          (r.service.url ?? '').toLowerCase().includes(q) ||
          (r.service.github_repository ?? '').toLowerCase().includes(q)),
    );
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'status':
          return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.service.name.localeCompare(b.service.name);
        case 'visitors':
          return b.visitors24h - a.visitors24h || a.service.name.localeCompare(b.service.name);
        case 'updated':
          return b.updatedAt.localeCompare(a.updatedAt);
        default:
          return a.service.name.localeCompare(b.service.name);
      }
    });
  }, [rows, query, status, sort]);

  if (error) {
    return (
      <div className="card">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GlobalMaintenance />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input !pl-9"
            placeholder="Поиск по названию, URL, репозиторию"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск сервисов"
          />
        </div>
        <select
          className="input !w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value as ServiceStatus | 'all')}
          aria-label="Фильтр по статусу"
        >
          <option value="all">Все статусы</option>
          <option value="operational">Работает</option>
          <option value="maintenance">Обслуживание</option>
          <option value="degraded">С ограничениями</option>
          <option value="unavailable">Недоступен</option>
          <option value="unknown">Нет данных</option>
        </select>
        <select
          className="input !w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Сортировка"
        >
          <option value="name">По названию</option>
          <option value="status">Сначала проблемные</option>
          <option value="visitors">По посетителям</option>
          <option value="updated">По обновлению</option>
        </select>
        <button className="btn btn-primary ml-auto" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Добавить сервис
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Сервисы не зарегистрированы" hint="Нажмите «Добавить сервис», чтобы зарегистрировать первый." />
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="Ничего не найдено"
            hint="Измените запрос или сбросьте фильтр по статусу."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => (
            <ServiceCard key={r.service.id} row={r} />
          ))}
        </div>
      )}

      {creating && (
        <ServiceFormDialog
          service={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
