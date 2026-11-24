import type { HealthRow, MaintenanceRow, Service, ServiceRow, ServiceStatus } from '@/types';

/** Заглушку считаем подключённой, если с неё был визит за последние 7 дней. */
const GUARD_FRESH_MS = 7 * 24 * 3600 * 1000;

export const STATUS_META: Record<
  ServiceStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  operational: { label: 'Работает', dot: 'bg-ok', text: 'text-ok', bg: 'bg-ok/10' },
  maintenance: { label: 'Обслуживание', dot: 'bg-maint', text: 'text-maint', bg: 'bg-maint/10' },
  degraded: { label: 'С ограничениями', dot: 'bg-warn', text: 'text-warn', bg: 'bg-warn/10' },
  unavailable: { label: 'Недоступен', dot: 'bg-bad', text: 'text-bad', bg: 'bg-bad/10' },
  unknown: { label: 'Нет данных', dot: 'bg-idle', text: 'text-muted', bg: 'bg-idle/10' },
};

/**
 * Статус обслуживания определяется ТОЛЬКО административными настройками,
 * доступность — ТОЛЬКО результатами проверок. Приоритет: глобальное → индивидуальное → проверки.
 */
export function buildServiceRows(
  services: Service[],
  maintenance: MaintenanceRow[],
  health: HealthRow[],
  visitors24h: Record<string, number>,
  /** Проверка старше этого срока не считается актуальной → статус unknown (монитор мог остановиться). */
  staleAfterMs: number = Infinity,
  /** service_id → последний визит с заглушкой; null — данных нет (миграция 0006 не применена). */
  guardSeen: Record<string, string> | null = null,
): ServiceRow[] {
  const now = Date.now();
  const globalRow = maintenance.find((m) => m.is_global);
  const byService = new Map(maintenance.filter((m) => m.service_id).map((m) => [m.service_id as string, m]));
  const healthByService = new Map(health.map((h) => [h.service_id, h]));

  return services.map((service) => {
    const own = byService.get(service.id);
    const h = healthByService.get(service.id);

    let maint: ServiceRow['maintenance'] = null;
    if (globalRow?.is_active && !own?.exempt_from_global) {
      maint = { source: 'global', message: globalRow.message, until: globalRow.scheduled_until };
    } else if (own?.is_active) {
      maint = { source: 'individual', message: own.message, until: own.scheduled_until };
    }

    const stale = h ? now - new Date(h.checked_at).getTime() > staleAfterMs : false;
    const status: ServiceStatus = maint ? 'maintenance' : h && !stale ? h.status : 'unknown';

    return {
      service,
      status,
      maintenance: maint,
      lastCheckedAt: h?.checked_at ?? null,
      responseTime: h?.response_time ?? null,
      visitors24h: visitors24h[service.id] ?? 0,
      own: own ?? null,
      updatedAt: own && own.updated_at > service.updated_at ? own.updated_at : service.updated_at,
      guardSeenAt: guardSeen?.[service.id] ?? null,
      guard: guardSeen === null ? 'unknown' : guardSeen[service.id] && now - new Date(guardSeen[service.id]).getTime() < GUARD_FRESH_MS ? 'ok' : 'missing',
    };
  });
}

export interface SystemSummary {
  tone: ServiceStatus;
  label: string;
}

export function summarize(rows: ServiceRow[]): SystemSummary {
  if (rows.length === 0) return { tone: 'unknown', label: 'Сервисы не зарегистрированы' };
  const c = (s: ServiceStatus) => rows.filter((r) => r.status === s).length;
  if (c('unavailable') > 0) return { tone: 'unavailable', label: `Недоступно: ${c('unavailable')}` };
  if (c('degraded') > 0) return { tone: 'degraded', label: `С ограничениями: ${c('degraded')}` };
  if (c('maintenance') > 0) return { tone: 'maintenance', label: `На обслуживании: ${c('maintenance')}` };
  if (c('unknown') === rows.length) return { tone: 'unknown', label: 'Нет данных проверок' };
  if (c('unknown') > 0) return { tone: 'operational', label: `Отвечают, часть без проверок` };
  return { tone: 'operational', label: 'Все сервисы отвечают' };
}
