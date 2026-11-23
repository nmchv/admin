import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { fetchSettings, setSetting } from '@/lib/supabase/api';

const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/** Значения по умолчанию — те же, что использует сервер, когда строки в cc_system_settings нет. */
export const SETTING_DEFAULTS = {
  'general.system_name': 'Control Center',
  'general.ecosystem_name': 'nmchv',
  'general.main_domain': 'nmchv.ru',
  'general.timezone': browserTz,
  'general.language': 'ru',
  'monitoring.interval_minutes': 5,
  'monitoring.slow_ms': 3000,
  'monitoring.timeout_ms': 10000,
  'monitoring.retention_days': 90,
  'analytics.enabled': true,
  'analytics.retention_days': 0,
  'notifications.down': true,
  'notifications.errors': true,
  'notifications.recovered': true,
  'notifications.settings_changed': true,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

interface SettingsContextValue {
  loading: boolean;
  error: string | null;
  get: <K extends SettingKey>(key: K) => (typeof SETTING_DEFAULTS)[K];
  /** Есть ли строка в БД (например, выпущен ли токен мониторинга). */
  has: (key: string) => boolean;
  save: (key: SettingKey, value: unknown) => Promise<void>;
  reload: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useAsync(fetchSettings, []);

  const map = useMemo(() => new Map((data ?? []).map((r) => [r.key, r.value])), [data]);

  const get = useCallback(
    <K extends SettingKey>(key: K): (typeof SETTING_DEFAULTS)[K] => {
      const v = map.get(key);
      const d = SETTING_DEFAULTS[key];
      // Тип значения должен совпадать с типом по умолчанию, иначе берём значение по умолчанию.
      return (v !== undefined && v !== null && typeof v === typeof d ? v : d) as (typeof SETTING_DEFAULTS)[K];
    },
    [map],
  );

  const value: SettingsContextValue = {
    loading,
    error,
    get,
    has: (key) => map.has(key),
    save: async (key, v) => {
      await setSetting(key, v);
    },
    reload,
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
