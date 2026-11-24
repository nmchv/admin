import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/lib/SettingsProvider';
import {
  fetchGuardStatus,
  fetchLatestHealth,
  fetchMaintenance,
  fetchServices,
  fetchVisitors24h,
} from '@/lib/supabase/api';
import { buildServiceRows } from '@/utils/status';
import type { MaintenanceRow, ServiceRow } from '@/types';

interface ServicesContextValue {
  rows: ServiceRow[];
  /** Строка глобального обслуживания (null, если миграция ещё не создала её). */
  globalRow: MaintenanceRow | null;
  loading: boolean;
  error: string | null;
  /** Ошибка только блока аналитики (миграция не применена и т. п.), не мешает статусам. */
  visitorsError: string | null;
  reload: () => void;
}

const ServicesContext = createContext<ServicesContextValue | null>(null);

/** Единый источник данных о сервисах для Sidebar, Header и Dashboard. */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const core = useAsync(
    async () => {
      const [services, maintenance, health] = await Promise.all([
        fetchServices(),
        fetchMaintenance(),
        fetchLatestHealth(),
      ]);
      return { services, maintenance, health };
    },
    [],
  );
  const visitors = useAsync(fetchVisitors24h, []);
  const guard = useAsync(fetchGuardStatus, []);

  const settings = useSettings();
  const staleAfterMs = Math.max(settings.get('monitoring.interval_minutes') * 3, 15) * 60_000;

  const rows = useMemo(
    () =>
      core.data
        ? buildServiceRows(core.data.services, core.data.maintenance, core.data.health, visitors.data ?? {}, staleAfterMs, guard.error || guard.loading ? null : guard.data ?? {})
        : [],
    [core.data, visitors.data, staleAfterMs, guard.data, guard.error, guard.loading],
  );

  const value: ServicesContextValue = {
    rows,
    globalRow: core.data?.maintenance.find((m) => m.is_global) ?? null,
    loading: core.loading,
    error: core.error,
    visitorsError: visitors.error,
    reload: () => {
      core.reload();
      visitors.reload();
      guard.reload();
    },
  };
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): ServicesContextValue {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used inside ServicesProvider');
  return ctx;
}
