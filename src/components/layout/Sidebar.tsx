import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusBadge';
import { useServices } from '@/lib/ServicesProvider';
import { useSettings } from '@/lib/SettingsProvider';
import { summarize } from '@/utils/status';

export const NAV_MAIN = [
  { to: '/', label: 'Overview', title: 'Главная панель', icon: LayoutDashboard },
  { to: '/services', label: 'Services', title: 'Сервисы', icon: Server },
  { to: '/analytics', label: 'Analytics', title: 'Аналитика', icon: BarChart3 },
  { to: '/monitoring', label: 'Monitoring', title: 'Мониторинг', icon: Activity },
  { to: '/users', label: 'Users', title: 'Пользователи', icon: Users },
  { to: '/logs', label: 'System Logs', title: 'Системные журналы', icon: ScrollText },
];

export const NAV_BOTTOM = [
  { to: '/settings', label: 'Settings', title: 'Настройки', icon: Settings },
  { to: '/profile', label: 'Admin Profile', title: 'Профиль администратора', icon: UserCircle },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onCloseMobile }: Props) {
  const { rows, loading, error } = useServices();
  const settings = useSettings();
  const summary = error ? { tone: 'unknown' as const, label: 'Supabase недоступен' } : summarize(rows);
  // На мобильных меню всегда развёрнуто; сворачивание — только для desktop.
  const slim = collapsed;

  const item = (n: (typeof NAV_MAIN)[number]) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.to === '/'}
      onClick={onCloseMobile}
      title={n.title}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
          isActive ? 'bg-elevated text-fg' : 'text-muted hover:bg-elevated/60 hover:text-fg'
        } ${slim ? 'lg:justify-center lg:px-0' : ''}`
      }
    >
      {({ isActive }) => (
        <>
          <n.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-accent' : ''}`} />
          <span className={slim ? 'lg:hidden' : ''}>{n.label}</span>
        </>
      )}
    </NavLink>
  );

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={onCloseMobile} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-line bg-surface transition-all duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${slim ? 'lg:w-[76px]' : 'lg:w-[264px]'}`}
      >
        <div className={`flex items-center gap-3 px-4 pb-4 pt-5 ${slim ? 'lg:justify-center lg:px-0' : ''}`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-elevated">
            <span className="text-sm font-extrabold tracking-tight text-accent">nm</span>
          </div>
          <div className={`min-w-0 flex-1 ${slim ? 'lg:hidden' : ''}`}>
            <p className="truncate text-sm font-extrabold tracking-tight">{settings.get('general.ecosystem_name')}</p>
            <p className="truncate text-xs text-muted">{settings.get('general.system_name')}</p>
          </div>
          <button className="text-muted hover:text-fg lg:hidden" onClick={onCloseMobile} aria-label="Закрыть меню">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className={`mx-3 mb-3 flex items-center gap-2.5 rounded-xl border border-line bg-bg/60 px-3 py-2 ${
            slim ? 'lg:justify-center lg:px-0' : ''
          }`}
          title={summary.label}
        >
          <StatusDot status={loading ? 'unknown' : summary.tone} pulse={!loading} />
          <span className={`truncate text-xs font-semibold text-muted ${slim ? 'lg:hidden' : ''}`}>
            {loading ? 'Проверяем состояние…' : summary.label}
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">{NAV_MAIN.map(item)}</nav>

        <div className="space-y-1 border-t border-line px-3 py-3">
          {NAV_BOTTOM.map(item)}
          <button
            onClick={onToggle}
            className={`hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-elevated/60 hover:text-fg lg:flex ${
              slim ? 'lg:justify-center lg:px-0' : ''
            }`}
            title={slim ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {slim ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
            {!slim && <span>Свернуть</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
