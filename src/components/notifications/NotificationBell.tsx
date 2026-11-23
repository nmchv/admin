import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle2, Hammer, ShieldAlert, Settings2 } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { fetchRecentLogs } from '@/lib/supabase/api';
import { useSettings } from '@/lib/SettingsProvider';
import { formatRelative } from '@/utils/format';
import type { LogRow } from '@/types';

const SEEN_KEY = 'cc:notifications-seen';

/** Какие события показывать — зависит от настроек уведомлений. */
export function isVisible(l: LogRow, s: { down: boolean; errors: boolean; recovered: boolean; changed: boolean }): boolean {
  const ev = l.metadata?.event as string | undefined;
  if (l.category === 'monitoring') {
    if (ev === 'recovered' || ev === 'infra_recovered') return s.recovered;
    if (ev === 'down' || ev === 'degraded') return s.down;
    return s.errors;
  }
  if (l.category === 'admin' || l.category === 'maintenance') return s.changed;
  return true; // security и system показываются всегда
}

function iconFor(l: LogRow) {
  const ev = l.metadata?.event as string | undefined;
  if (ev === 'recovered' || ev === 'infra_recovered') return <CheckCircle2 className="h-4 w-4 text-ok" />;
  if (ev === 'down' || ev === 'infra_down') return <ShieldAlert className="h-4 w-4 text-bad" />;
  if (ev === 'degraded') return <AlertTriangle className="h-4 w-4 text-warn" />;
  if (l.category === 'maintenance') return <Hammer className="h-4 w-4 text-maint" />;
  if (l.category === 'security') return <ShieldAlert className="h-4 w-4 text-warn" />;
  return <Settings2 className="h-4 w-4 text-muted" />;
}

function readSeen(): number {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    if (v) return Number(v);
    const now = Date.now(); // первый запуск: прошлые события не считаются непрочитанными
    localStorage.setItem(SEEN_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

export function NotificationBell() {
  const settings = useSettings();
  const { data, error, reload } = useAsync(() => fetchRecentLogs(30), []);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const ref = useRef<HTMLDivElement>(null);

  // периодическое обновление раз в минуту
  useEffect(() => {
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filter = {
    down: settings.get('notifications.down'),
    errors: settings.get('notifications.errors'),
    recovered: settings.get('notifications.recovered'),
    changed: settings.get('notifications.settings_changed'),
  };
  const items = (data ?? []).filter((l) => isVisible(l, filter)).slice(0, 15);
  const unread = items.filter((l) => new Date(l.created_at).getTime() > seen).length;

  const markRead = () => {
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn relative !px-2.5"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Уведомления: ${unread} новых` : 'Уведомления'}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-extrabold text-[#08090B]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-extrabold tracking-tight">Уведомления</h2>
            <button className="text-xs font-semibold text-accent hover:underline disabled:opacity-40" onClick={markRead} disabled={!unread}>
              Отметить прочитанными
            </button>
          </div>
          {error ? (
            <p className="px-4 py-6 text-center text-xs text-bad">Не удалось загрузить: {error}</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Новых событий нет</p>
          ) : (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
              {items.map((l) => {
                const isNew = new Date(l.created_at).getTime() > seen;
                return (
                  <li key={l.id} className={`flex gap-3 px-4 py-3 ${isNew ? 'bg-accent/5' : ''}`}>
                    <span className="mt-0.5 shrink-0">{iconFor(l)}</span>
                    <div className="min-w-0">
                      <p className="break-words text-sm leading-snug">{l.message}</p>
                      <p className="mt-0.5 text-xs text-muted">{formatRelative(l.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2.5 text-center">
            <Link to="/logs" onClick={() => setOpen(false)} className="text-xs font-semibold text-accent hover:underline">
              Все события
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
