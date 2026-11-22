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
