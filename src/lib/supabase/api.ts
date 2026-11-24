import { supabase } from './client';
import type {
  ActivityRow,
  AdminRow,
  HealthPoint,
  Incident,
  InfraRow,
  RegistrationPoint,
  UptimeRow,
  UsersByService,
  UsersSummary,
  AnalyticsOverview,
  BreakdownDim,
  BreakdownRow,
  ServiceTraffic,
  TopPage,
  DashboardTotals,
  HealthRow,
  LogRow,
  MaintenanceRow,
  SeriesPoint,
  Service,
  AccessProject,
  PermissionCatalogRow,
  ProjectGrant,
  UserCharts,
  UserPermission,
  UserRole,
  UserListRow,
  UserOverview,
  UserTableInfo,
  UserTableRows,
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

// ---------- аналитика ----------

const num = (v: unknown) => Number(v ?? 0);

export async function fetchOverview(from: Date, to: Date, serviceId: string | null): Promise<AnalyticsOverview> {
  const rows = unwrap<Record<string, unknown>[]>(
    await supabase.rpc('cc_analytics_overview', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_service: serviceId,
    }),
  );
  const r = rows[0] ?? {};
  return {
    visitors: num(r.visitors),
    sessions: num(r.sessions),
    page_views: num(r.page_views),
    new_visitors: num(r.new_visitors),
    returning_visitors: num(r.returning_visitors),
    avg_session_seconds: r.avg_session_seconds == null ? null : num(r.avg_session_seconds),
    prev_visitors: num(r.prev_visitors),
    prev_sessions: num(r.prev_sessions),
    prev_page_views: num(r.prev_page_views),
  };
}

export async function fetchTopPages(from: Date, to: Date, serviceId: string | null, limit = 10): Promise<TopPage[]> {
  const rows = unwrap<TopPage[]>(
    await supabase.rpc('cc_analytics_top_pages', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_service: serviceId,
      p_limit: limit,
    }),
  );
  return rows.map((r) => ({ ...r, views: num(r.views), visitors: num(r.visitors) }));
}

export async function fetchTrafficByService(from: Date, to: Date): Promise<ServiceTraffic[]> {
  const rows = unwrap<ServiceTraffic[]>(
    await supabase.rpc('cc_analytics_by_service', { p_from: from.toISOString(), p_to: to.toISOString() }),
  );
  return rows.map((r) => ({
    service_id: r.service_id,
    visitors: num(r.visitors),
    sessions: num(r.sessions),
    page_views: num(r.page_views),
  }));
}

export async function fetchBreakdown(
  from: Date,
  to: Date,
  dim: BreakdownDim,
  serviceId: string | null,
): Promise<BreakdownRow[]> {
  const rows = unwrap<BreakdownRow[]>(
    await supabase.rpc('cc_analytics_breakdown', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_dim: dim,
      p_service: serviceId,
      p_limit: 8,
    }),
  );
  return rows.map((r) => ({ label: r.label, visitors: num(r.visitors) }));
}

// ---------- мониторинг ----------

export async function fetchUptime(): Promise<UptimeRow[]> {
  const rows = unwrap<Record<string, unknown>[]>(await supabase.rpc('cc_monitoring_overview'));
  const n = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    service_id: String(r.service_id),
    uptime_24h: n(r.uptime_24h),
    uptime_7d: n(r.uptime_7d),
    uptime_30d: n(r.uptime_30d),
    avg_response_ms: n(r.avg_response_ms),
    checks_24h: num(r.checks_24h),
    last_check_at: (r.last_check_at as string | null) ?? null,
    last_incident_at: (r.last_incident_at as string | null) ?? null,
    open_incident: Boolean(r.open_incident),
  }));
}

export async function fetchInfra(): Promise<InfraRow[]> {
  const rows = unwrap<Record<string, unknown>[]>(await supabase.rpc('cc_infra_summary'));
  return rows.map((r) => ({
    component: r.component as InfraRow['component'],
    status: (r.status as InfraRow['status']) ?? null,
    response_time: r.response_time == null ? null : Number(r.response_time),
    error_message: (r.error_message as string | null) ?? null,
    checked_at: (r.checked_at as string | null) ?? null,
    checks_24h: num(r.checks_24h),
    failures_24h: num(r.failures_24h),
    avg_ms_24h: r.avg_ms_24h == null ? null : Number(r.avg_ms_24h),
  }));
}

export async function fetchIncidents(serviceId: string | null, limit = 50): Promise<Incident[]> {
  let q = supabase.from('cc_incidents').select('*').order('started_at', { ascending: false }).limit(limit);
  if (serviceId) q = q.eq('service_id', serviceId);
  return unwrap(await q);
}

export async function fetchHealthSeries(serviceId: string, hours = 24): Promise<HealthPoint[]> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  return unwrap(
    await supabase
      .from('cc_service_health')
      .select('checked_at,status,response_time')
      .eq('service_id', serviceId)
      .gte('checked_at', since)
      .order('checked_at', { ascending: true })
      .limit(1000),
  );
}

// ---------- пользователи ----------

export async function fetchUsersList(a: {
  q: string;
  limit: number;
  offset: number;
  sort: string;
}): Promise<UserListRow[]> {
  const rows = unwrap<UserListRow[]>(
    await supabase.rpc('cc_users_list', {
      p_q: a.q.trim() || null,
      p_limit: a.limit,
      p_offset: a.offset,
      p_sort: a.sort,
    }),
  );
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

/** Открытие карточки пишется в журнал действий администратора (на сервере). */
export async function fetchUserOverview(userId: string, log = true): Promise<UserOverview> {
  return unwrap<UserOverview>(await supabase.rpc('cc_user_overview', { p_user: userId, p_log: log }));
}

export async function fetchUserCharts(userId: string, days: number, tz: string): Promise<UserCharts> {
  return unwrap<UserCharts>(await supabase.rpc('cc_user_charts', { p_user: userId, p_days: days, p_tz: tz }));
}

export async function fetchUserTables(userId: string): Promise<UserTableInfo[]> {
  const rows = unwrap<UserTableInfo[]>(await supabase.rpc('cc_user_tables', { p_user: userId }));
  return rows.map((r) => ({ ...r, row_count: Number(r.row_count) }));
}

export async function fetchUserTableRows(
  userId: string,
  table: string,
  limit: number,
  offset: number,
): Promise<UserTableRows> {
  return unwrap<UserTableRows>(
    await supabase.rpc('cc_user_table_rows', { p_user: userId, p_table: table, p_limit: limit, p_offset: offset }),
  );
}

/** service_id → время последнего визита с подключённой заглушкой. */
export async function fetchGuardStatus(): Promise<Record<string, string>> {
  const rows = unwrap<{ service_id: string; guard_seen_at: string }[]>(await supabase.rpc('cc_guard_status'));
  return Object.fromEntries(rows.map((r) => [r.service_id, r.guard_seen_at]));
}

export async function fetchUsersSummary(): Promise<UsersSummary> {
  const r = unwrap<Record<string, unknown>[]>(await supabase.rpc('cc_users_summary'))[0] ?? {};
  return {
    registered: num(r.registered),
    admins: num(r.admins),
    new_7d: num(r.new_7d),
    new_30d: num(r.new_30d),
    active_7d: num(r.active_7d),
    active_30d: num(r.active_30d),
    in_services: num(r.in_services),
  };
}

export async function fetchUsersByService(): Promise<UsersByService[]> {
  const rows = unwrap<UsersByService[]>(await supabase.rpc('cc_users_by_service'));
  return rows.map((r) => ({
    service_id: r.service_id,
    users: num(r.users),
    new_30d: num(r.new_30d),
    active_30d: num(r.active_30d),
  }));
}

export async function fetchRegistrations(from: Date, to: Date): Promise<RegistrationPoint[]> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rows = unwrap<RegistrationPoint[]>(
    await supabase.rpc('cc_registrations_series', { p_from: from.toISOString(), p_to: to.toISOString(), p_tz: tz }),
  );
  return rows.map((r) => ({ bucket: r.bucket, registrations: num(r.registrations) }));
}

// ---------- журналы ----------

export interface LogQuery {
  categories: string[];
  serviceId: string | null;
  q: string;
  from: Date | null;
  to: Date | null;
  asc: boolean;
  page: number;
  pageSize: number;
}

export async function fetchLogs(p: LogQuery): Promise<{ rows: LogRow[]; total: number }> {
  let q = supabase.from('cc_system_logs').select('*', { count: 'exact' });
  if (p.categories.length) q = q.in('category', p.categories);
  if (p.serviceId) q = q.eq('service_id', p.serviceId);
  if (p.q.trim()) q = q.ilike('message', `%${p.q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`);
  if (p.from) q = q.gte('created_at', p.from.toISOString());
  if (p.to) q = q.lt('created_at', p.to.toISOString());
  const from = p.page * p.pageSize;
  const res = await q.order('created_at', { ascending: p.asc }).order('id', { ascending: p.asc }).range(from, from + p.pageSize - 1);
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as LogRow[], total: res.count ?? 0 };
}

export async function fetchActivity(p: {
  from: Date | null;
  to: Date | null;
  actionPrefix: string | null;
  asc: boolean;
  page: number;
  pageSize: number;
}): Promise<{ rows: ActivityRow[]; total: number }> {
  let q = supabase.from('cc_admin_activity').select('*', { count: 'exact' });
  if (p.actionPrefix) q = q.like('action', `${p.actionPrefix}%`);
  if (p.from) q = q.gte('created_at', p.from.toISOString());
  if (p.to) q = q.lt('created_at', p.to.toISOString());
  const from = p.page * p.pageSize;
  const res = await q.order('created_at', { ascending: p.asc }).order('id', { ascending: p.asc }).range(from, from + p.pageSize - 1);
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as ActivityRow[], total: res.count ?? 0 };
}

// ---------- администраторы и настройки ----------

export async function fetchAdmins(): Promise<AdminRow[]> {
  return unwrap(await supabase.rpc('cc_list_admins'));
}

export async function fetchSettings(): Promise<{ key: string; value: unknown }[]> {
  return unwrap(await supabase.from('cc_system_settings').select('key,value'));
}

// ---------- запись (только через RPC с серверной проверкой роли) ----------

export async function setSetting(key: string, value: unknown): Promise<void> {
  check(await supabase.rpc('cc_set_setting', { p_key: key, p_value: value }));
}

export async function setHealthPaths(serviceId: string, paths: string[]): Promise<void> {
  check(await supabase.rpc('cc_set_health_paths', { p_service_id: serviceId, p_paths: paths }));
}

/** Токен возвращается один раз — в БД остаётся только хэш. */
export async function rotateMonitorToken(): Promise<string> {
  const res = await supabase.rpc('cc_rotate_monitor_token');
  check(res);
  return String(res.data);
}

export async function grantAdmin(email: string, role: 'owner' | 'admin'): Promise<void> {
  check(await supabase.rpc('cc_grant_admin', { p_email: email, p_role: role }));
}

export async function revokeAdmin(adminId: string): Promise<void> {
  check(await supabase.rpc('cc_revoke_admin', { p_admin_id: adminId }));
}

// ---------- запись: сервисы и обслуживание (через RPC с серверной проверкой роли) ----------

function humanize(e: { message: string; code?: string }): string {
  // Сообщения наших функций уже написаны по-русски — показываем как есть.
  if (/[А-Яа-яЁё]/.test(e.message)) return e.message;
  if (e.code === '42501' || /forbidden/i.test(e.message)) return 'Недостаточно прав для этого действия.';
  if (/user not found/i.test(e.message)) return 'Пользователь не найден. Сначала создайте его в Supabase → Authentication → Users.';
  if (/cannot revoke yourself/i.test(e.message)) return 'Нельзя отозвать права у самого себя.';
  if (/cannot revoke last owner/i.test(e.message)) return 'Нельзя отозвать права у последнего владельца.';
  if (/invalid value|unknown setting/i.test(e.message)) return 'Недопустимое значение настройки.';
  if (/invalid path/i.test(e.message)) return 'Пути должны начинаться с «/», без пробелов (до 5 путей).';
  if (e.code === '23505' && /admin/i.test(e.message)) return 'Этот пользователь уже администратор.';
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
  serviceId: string | null = null,
): Promise<SeriesPoint[]> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rows = unwrap<SeriesPoint[]>(
    await supabase.rpc('cc_analytics_series', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_bucket: bucket,
      p_tz: tz,
      p_service: serviceId,
    }),
  );
  return rows.map((r) => ({
    bucket: r.bucket,
    visitors: Number(r.visitors),
    sessions: Number(r.sessions),
    page_views: Number(r.page_views),
  }));
}

/** Пути проверки доступности по сервисам (по умолчанию ["/"]). */
export async function fetchHealthPaths(): Promise<Record<string, string[]>> {
  const rows = unwrap<{ service_id: string; settings: Record<string, unknown> | null }[]>(
    await supabase.from('cc_service_settings').select('service_id,settings'),
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const p = r.settings?.health_paths;
    if (Array.isArray(p) && p.length) out[r.service_id] = p.map(String);
  }
  return out;
}

// ---------- доступ к сервисам, роли и права ----------

export async function fetchAccessProjects(): Promise<AccessProject[]> {
  const rows = unwrap<AccessProject[]>(await supabase.rpc('cc_access_projects'));
  return rows.map((r) => ({ ...r, active_users: Number(r.active_users), total_grants: Number(r.total_grants) }));
}

export async function fetchProjectGrants(a: {
  projectId: string;
  q: string;
  limit: number;
  offset: number;
}): Promise<ProjectGrant[]> {
  const rows = unwrap<ProjectGrant[]>(
    await supabase.rpc('cc_project_grants', {
      p_project: a.projectId,
      p_q: a.q.trim() || null,
      p_limit: a.limit,
      p_offset: a.offset,
    }),
  );
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

/** Выдать доступ или изменить уровень, срок и включённость (повторный вызов обновляет). */
export async function grantProjectAccess(a: {
  userId: string;
  projectId: string;
  level: string;
  expires: string | null;
  active: boolean;
}): Promise<void> {
  check(
    await supabase.rpc('cc_grant_project_access', {
      p_user: a.userId,
      p_project: a.projectId,
      p_level: a.level,
      p_expires: a.expires,
      p_active: a.active,
    }),
  );
}

export async function revokeProjectAccess(userId: string, projectId: string): Promise<void> {
  check(await supabase.rpc('cc_revoke_project_access', { p_user: userId, p_project: projectId }));
}

export async function setUserRole(userId: string, role: UserRole | null): Promise<void> {
  check(await supabase.rpc('cc_set_user_role', { p_user: userId, p_role: role }));
}

export async function fetchPermissionsCatalog(): Promise<PermissionCatalogRow[]> {
  return unwrap<PermissionCatalogRow[]>(await supabase.rpc('cc_permissions_catalog'));
}

/** Глобальное действие, доступно только владельцу (owner). */
export async function setRolePermission(role: UserRole, permissionId: string, allowed: boolean): Promise<void> {
  check(await supabase.rpc('cc_set_role_permission', { p_role: role, p_permission: permissionId, p_allowed: allowed }));
}

export async function fetchUserPermissions(userId: string): Promise<UserPermission[]> {
  return unwrap<UserPermission[]>(await supabase.rpc('cc_user_permissions', { p_user: userId }));
}

/** allowed = null — убрать исключение (вернуть право роли). */
export async function setUserPermissionOverride(a: {
  userId: string;
  permissionId: string;
  allowed: boolean | null;
  reason: string | null;
  expires: string | null;
}): Promise<void> {
  check(
    await supabase.rpc('cc_set_user_permission_override', {
      p_user: a.userId,
      p_permission: a.permissionId,
      p_allowed: a.allowed,
      p_reason: a.reason,
      p_expires: a.expires,
    }),
  );
}
