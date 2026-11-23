import type { Period } from '@/types';

const nf = new Intl.NumberFormat('ru-RU');
export const formatNumber = (n: number) => nf.format(n);

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'ещё не проверялся';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

/** Длительность между двумя моментами (до now, если конец не задан). */
export function formatSpan(startIso: string, endIso: string | null): string {
  const ms = (endIso ? new Date(endIso).getTime() : Date.now()) - new Date(startIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} дн ${h % 24} ч`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${s % 60} с`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

/** ISO → значение для <input type="datetime-local"> (локальное время). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Значение datetime-local → ISO (UTC) или null. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatFullDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}

/** Изменение к предыдущему периоду в %. null — сравнивать не с чем. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export interface Range {
  from: Date;
  to: Date;
  bucket: 'hour' | 'day' | 'month';
}

export function resolveRange(period: Period, custom?: { from: string; to: string }): Range {
  const now = new Date();
  const dayMs = 86_400_000;
  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: new Date(start.getTime() + dayMs), bucket: 'hour' };
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * dayMs), to: now, bucket: 'day' };
    case '30d':
      return { from: new Date(now.getTime() - 30 * dayMs), to: now, bucket: 'day' };
    case '90d':
      return { from: new Date(now.getTime() - 90 * dayMs), to: now, bucket: 'day' };
    case '12m':
      return { from: new Date(now.getTime() - 365 * dayMs), to: now, bucket: 'month' };
    case 'custom': {
      const from = custom?.from ? new Date(`${custom.from}T00:00:00`) : new Date(now.getTime() - 7 * dayMs);
      const to = custom?.to ? new Date(new Date(`${custom.to}T00:00:00`).getTime() + dayMs) : now;
      const span = to.getTime() - from.getTime();
      const bucket = span <= dayMs ? 'hour' : span <= 92 * dayMs ? 'day' : 'month';
      return { from, to, bucket };
    }
  }
}

export function formatBucket(iso: string, bucket: Range['bucket']): string {
  const d = new Date(iso);
  if (bucket === 'hour') return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
  if (bucket === 'month') return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(d);
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(d);
}
