import type { UserPermission, UserRole } from '@/types';

export const ROLE_LABEL: Record<UserRole, string> = { teacher: 'Учитель', student: 'Ученик' };

export const SOURCE_LABEL: Record<UserPermission['source'], string> = {
  super_admin: 'Суперадминистратор',
  override: 'Персонально',
  role: 'По роли',
  default: 'По умолчанию',
};

/** Состояние доступа пользователя к сервису. */
export function accessState(g: { is_active: boolean; expires_at: string | null } | undefined): {
  label: string;
  tone: 'ok' | 'off' | 'none';
} {
  if (!g) return { label: 'Нет доступа', tone: 'none' };
  if (!g.is_active) return { label: 'Отключён', tone: 'off' };
  if (g.expires_at && new Date(g.expires_at) <= new Date()) return { label: 'Срок истёк', tone: 'off' };
  return { label: 'Доступ есть', tone: 'ok' };
}

export const TONE_CLASS = {
  ok: 'bg-ok/10 text-ok',
  off: 'bg-warn/10 text-warn',
  none: 'bg-elevated text-muted',
} as const;
