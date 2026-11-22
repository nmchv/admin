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
}

export type Period = 'today' | '7d' | '30d' | '90d' | '12m' | 'custom';
export type Metric = 'visitors' | 'sessions' | 'page_views';
