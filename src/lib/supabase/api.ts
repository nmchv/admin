import { supabase } from './client';
import type {
  DashboardTotals,
  HealthRow,
  LogRow,
  MaintenanceRow,
  SeriesPoint,
  Service,
} from '@/types';

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

export async function fetchServices(): Promise<Service[]> {
  return unwrap(await supabase.from('cc_services').select('*').order('name'));
}

export async function fetchMaintenance(): Promise<MaintenanceRow[]> {
  return unwrap(await supabase.from('cc_maintenance_settings').select('*'));
}

export async function fetchLatestHealth(): Promise<HealthRow[]> {
  return unwrap(await supabase.from('cc_service_latest_health').select('*'));
}

export async function fetchVisitors24h(): Promise<Record<string, number>> {
  const rows = unwrap<{ service_id: string; visitors: number }[]>(
    await supabase.rpc('cc_service_visitors_24h'),
  );
  return Object.fromEntries(rows.map((r) => [r.service_id, Number(r.visitors)]));
}

export async function fetchRecentLogs(limit = 10): Promise<LogRow[]> {
  return unwrap(
    await supabase.from('cc_system_logs').select('*').order('created_at', { ascending: false }).limit(limit),
  );
}

export async function fetchServiceLogs(serviceId: string, limit = 20): Promise<LogRow[]> {
  return unwrap(
    await supabase
      .from('cc_system_logs')
      .select('*')
      .eq('service_id', serviceId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

// ---------- запись (только через RPC с серверной проверкой роли) ----------

function humanize(e: { message: string; code?: string }): string {
  if (e.code === '42501' || /forbidden/i.test(e.message)) return 'Недостаточно прав для этого действия.';
  if (e.code === '23505') return 'Сервис с таким идентификатором уже существует.';
  if (e.code === '23514' || e.code === '23502') return 'Значение не прошло проверку — проверьте поля формы.';
  if (e.code === '22001') return 'Слишком длинное значение (сообщение — до 500 символов).';
  if (e.code === 'P0002') return 'Сервис не найден.';
  if (e.code === 'PGRST202') return 'Функция не найдена в БД — примените миграцию 0002_services_maintenance_rpc.sql.';
  return e.message;
}

function check(res: { error: { message: string; code?: string } | null }): void {
  if (res.error) throw new Error(humanize(res.error));
}

export async function setServiceMaintenance(a: {
  serviceId: string;
  active: boolean;
  message: string | null;
  until: string | null;
  /** null — не менять */
  exempt: boolean | null;
}): Promise<void> {
  check(
    await supabase.rpc('cc_set_maintenance', {
      p_service_id: a.serviceId,
      p_active: a.active,
      p_message: a.message,
      p_until: a.until,
      p_exempt: a.exempt,
    }),
  );
}

/** Возвращает число затронутых сервисов. */
export async function setGlobalMaintenance(a: {
  active: boolean;
  message: string | null;
  until: string | null;
}): Promise<number> {
  const res = await supabase.rpc('cc_set_global_maintenance', {
    p_active: a.active,
    p_message: a.message,
    p_until: a.until,
  });
  check(res);
  return Number(res.data ?? 0);
}

export async function saveService(a: {
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  url: string | null;
  github: string | null;
  isEnabled: boolean;
}): Promise<string> {
  const res = await supabase.rpc('cc_upsert_service', {
    p_id: a.id,
    p_slug: a.slug,
    p_name: a.name,
    p_description: a.description,
    p_url: a.url,
    p_github: a.github,
    p_is_enabled: a.isEnabled,
  });
  check(res);
  return String(res.data);
}

export async function fetchTotals(from: Date, to: Date): Promise<DashboardTotals> {
  const rows = unwrap<DashboardTotals[]>(
    await supabase.rpc('cc_dashboard_totals', { p_from: from.toISOString(), p_to: to.toISOString() }),
  );
  const r = rows[0];
  const n = (v: unknown) => Number(v ?? 0);
  return {
    visitors: n(r?.visitors),
    sessions: n(r?.sessions),
    page_views: n(r?.page_views),
    prev_visitors: n(r?.prev_visitors),
    prev_sessions: n(r?.prev_sessions),
    prev_page_views: n(r?.prev_page_views),
    active_24h: n(r?.active_24h),
  };
}

export async function fetchSeries(
  from: Date,
  to: Date,
  bucket: 'hour' | 'day' | 'month',
): Promise<SeriesPoint[]> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rows = unwrap<SeriesPoint[]>(
    await supabase.rpc('cc_visits_series', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_bucket: bucket,
      p_tz: tz,
    }),
  );
  return rows.map((r) => ({
    bucket: r.bucket,
    visitors: Number(r.visitors),
    sessions: Number(r.sessions),
    page_views: Number(r.page_views),
  }));
}
