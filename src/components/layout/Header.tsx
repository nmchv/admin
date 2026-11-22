import { Link, useLocation } from 'react-router-dom';
import { Bell, ChevronRight, Menu } from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/ServicesProvider';
import { useNow } from '@/hooks/useNow';
import { summarize } from '@/utils/status';
import { NAV_BOTTOM, NAV_MAIN } from './Sidebar';

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname } = useLocation();
  const { user, admin } = useAuth();
  const { rows, loading, error } = useServices();
  const now = useNow();

  const current = [...NAV_MAIN, ...NAV_BOTTOM].find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)));
  const title = current?.title ?? 'Control Center';

  const summary = error ? { tone: 'unknown' as const, label: 'Supabase недоступен' } : summarize(rows);
  const initial = (user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
      <button className="btn !px-2.5 lg:hidden" onClick={onOpenMenu} aria-label="Открыть меню">
        <Menu className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <nav className="hidden items-center gap-1 text-xs text-muted sm:flex" aria-label="Хлебные крошки">
          <Link to="/" className="hover:text-fg">
            Control Center
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>{title}</span>
        </nav>
        <h1 className="truncate text-base font-extrabold tracking-tight sm:text-lg">{title}</h1>
      </div>

      <div
        className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 md:flex"
        title="Сводка по последним проверкам доступности сайтов. Состояние Supabase и API здесь не оценивается."
      >
        <StatusDot status={loading ? 'unknown' : summary.tone} pulse={!loading} />
        <span className="text-xs font-semibold text-muted">{loading ? 'Загрузка…' : summary.label}</span>
      </div>

      <time className="hidden text-sm font-semibold tabular-nums text-muted sm:block">
        {new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(now)}
      </time>

      <button
        className="btn !px-2.5 opacity-60"
        disabled
        title="Центр уведомлений запланирован (этап 5)"
        aria-label="Центр уведомлений — запланирован"
      >
        <Bell className="h-4 w-4" />
      </button>

      <Link
        to="/profile"
        title={`${user?.email ?? ''} · ${admin?.role ?? ''}`}
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-elevated text-sm font-extrabold text-accent transition-colors hover:border-accent/60"
      >
        {initial}
      </Link>
    </header>
  );
}
