export type ServiceStatus = 'operational' | 'maintenance' | 'degraded' | 'unavailable' | 'unknown';

export interface Service {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  url: string | null;
  github_repository: string | null;
  icon: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceRow {
  id: string;
  service_id: string | null;
  is_global: boolean;
  is_active: boolean;
  exempt_from_global: boolean;
  message: string | null;
  scheduled_until: string | null;
  updated_at: string;
}

export interface HealthRow {
  service_id: string;
  status: 'operational' | 'degraded' | 'unavailable';
  response_time: number | null;
  http_status: number | null;
  checked_at: string;
}

export interface LogRow {
  id: number;
  category: 'admin' | 'maintenance' | 'system' | 'security' | 'monitoring' | 'analytics';
  service_id: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DashboardTotals {
  visitors: number;
  sessions: number;
  page_views: number;
  prev_visitors: number;
  prev_sessions: number;
  prev_page_views: number;
  active_24h: number;
}

export interface SeriesPoint {
  bucket: string;
  visitors: number;
  sessions: number;
  page_views: number;
}

/** Сервис с вычисленным статусом (обслуживание из настроек, доступность — из проверок). */
export interface ServiceRow {
  service: Service;
  status: ServiceStatus;
  maintenance: { source: 'global' | 'individual'; message: string | null; until: string | null } | null;
  lastCheckedAt: string | null;
  responseTime: number | null;
  visitors24h: number;
  /** Строка индивидуального обслуживания (настройки, не итоговый статус). */
  own: MaintenanceRow | null;
  /** Последнее изменение сервиса или его настроек обслуживания. */
  updatedAt: string;
  /**
   * Подключена ли на сайте заглушка maintenance.js:
   * ok — был визит с заглушкой за последние 7 дней, missing — не было, unknown — данных нет (миграция 0006 не применена).
   */
  guard: 'ok' | 'missing' | 'unknown';
  guardSeenAt: string | null;
}

export interface AnalyticsOverview {
  visitors: number;
  sessions: number;
  page_views: number;
  new_visitors: number;
  returning_visitors: number;
  /** null — нет сессий из 2+ событий, длительность посчитать не из чего. */
  avg_session_seconds: number | null;
  prev_visitors: number;
  prev_sessions: number;
  prev_page_views: number;
}

export interface TopPage {
  service_id: string;
  page_path: string;
  views: number;
  visitors: number;
}

export interface ServiceTraffic {
  service_id: string;
  visitors: number;
  sessions: number;
  page_views: number;
}

export type BreakdownDim = 'source' | 'device' | 'os' | 'browser' | 'country';

export interface BreakdownRow {
  label: string;
  visitors: number;
}

export type Period ='today' | '7d' | '30d' | '90d' | '12m' | 'custom';
export type Metric = 'visitors' | 'sessions' | 'page_views';

export type HealthStatus = 'operational' | 'degraded' | 'unavailable';

export interface UptimeRow {
  service_id: string;
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  avg_response_ms: number | null;
  checks_24h: number;
  last_check_at: string | null;
  last_incident_at: string | null;
  open_incident: boolean;
}

export interface InfraRow {
  component: 'database' | 'api' | 'auth';
  status: HealthStatus | null;
  response_time: number | null;
  error_message: string | null;
  checked_at: string | null;
  checks_24h: number;
  failures_24h: number;
  avg_ms_24h: number | null;
}

export interface Incident {
  id: number;
  service_id: string;
  severity: 'degraded' | 'unavailable';
  started_at: string;
  resolved_at: string | null;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
}

export interface HealthPoint {
  checked_at: string;
  status: HealthStatus;
  response_time: number | null;
}

export interface UsersSummary {
  registered: number;
  admins: number;
  new_7d: number;
  new_30d: number;
  active_7d: number;
  active_30d: number;
  in_services: number;
}

export interface UsersByService {
  service_id: string;
  users: number;
  new_30d: number;
  active_30d: number;
}

export interface RegistrationPoint {
  bucket: string;
  registrations: number;
}

export interface AdminRow {
  id: string;
  auth_user_id: string;
  email: string;
  role: 'owner' | 'admin';
  created_at: string;
  last_sign_in_at: string | null;
}

export interface ActivityRow {
  id: number;
  admin_id: string | null;
  action: string;
  target_service_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ---------- пользователи (карточка) ----------

export interface UserListRow {
  user_id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  username: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  is_banned: boolean;
  services: string[];
  total: number;
  role: UserRole | null;
  is_super_admin: boolean;
}

export interface UserOverview {
  auth: {
    id: string;
    email: string | null;
    phone: string | null;
    email_confirmed_at: string | null;
    phone_confirmed_at: string | null;
    created_at: string;
    updated_at: string | null;
    last_sign_in_at: string | null;
    banned_until: string | null;
    is_anonymous: boolean;
    providers: string[] | null;
    user_metadata: Record<string, unknown>;
  };
  profile: Record<string, unknown> | null;
  is_admin: boolean;
  is_super_admin: boolean;
  role: UserRole | null;
  projects: {
    project_id: string;
    slug: string;
    name: string;
    access_level: string;
    is_active: boolean;
    expires_at: string | null;
    since: string;
  }[];
}

export interface UserCharts {
  activity: { day: string; n: number }[];
  attempts: {
    at: string;
    exam_id: string;
    mode: string;
    status: string;
    score: number | null;
    max_score: number | null;
    percentage: number | null;
  }[];
  by_project: { slug: string; name: string; n: number }[];
  by_event: { event_type: string; n: number }[];
  progress: { exam_id: string; tasks: number; attempts: number; correct: number }[];
  totals: {
    attempts: number;
    attempts_done: number;
    avg_percentage: number | null;
    best_percentage: number | null;
    events: number;
    achievements: number;
    goals: number;
    notifications_unread: number;
    last_activity: string | null;
  };
}

export interface UserTableInfo {
  tbl: string;
  depth: number;
  via: string;
  row_count: number;
}

export interface UserTableRows {
  total: number;
  rows: Record<string, unknown>[];
  hidden_columns: string[];
}

// ---------- доступ, роли и права ----------

export type UserRole = 'teacher' | 'student';

export interface AccessProject {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: string;
  visibility: string;
  url: string;
  active_users: number;
  total_grants: number;
}

export interface ProjectGrant {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole | null;
  access_level: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  total: number;
}

export interface PermissionCatalogRow {
  id: string;
  permission_key: string;
  service: string;
  name: string;
  description: string | null;
  teacher: boolean;
  student: boolean;
}

export interface UserPermission {
  permission_id: string;
  permission_key: string;
  service: string;
  name: string;
  description: string | null;
  role_allowed: boolean | null;
  override_allowed: boolean | null;
  override_reason: string | null;
  override_expires_at: string | null;
  effective: boolean;
  source: 'super_admin' | 'override' | 'role' | 'default';
}
