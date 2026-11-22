import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { ToastProvider } from '@/components/ui/Toast';
import { Layout } from '@/components/layout/Layout';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import Profile from '@/pages/Profile';
import Planned from '@/pages/Planned';

function ConfigError() {
  return (
    <div className="grid min-h-full place-items-center px-4">
      <div className="card max-w-md space-y-3 p-6 text-center">
        <TriangleAlert className="mx-auto h-6 w-6 text-warn" />
        <h1 className="text-base font-extrabold">Supabase не настроен</h1>
        <p className="text-sm leading-relaxed text-muted">
          Не заданы переменные <code className="text-fg">VITE_SUPABASE_URL</code> и{' '}
          <code className="text-fg">VITE_SUPABASE_ANON_KEY</code>. Скопируйте <code className="text-fg">.env.example</code> в{' '}
          <code className="text-fg">.env</code> (локально) или добавьте их как secrets репозитория (для GitHub Actions).
        </p>
      </div>
    </div>
  );
}

function Gate() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="grid min-h-full place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }
  if (status === 'signed_out') return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route
          path="services"
          element={
            <Planned
              title="Services"
              stage="этап 2"
              items={[
                'Реестр сервисов с поиском и фильтрами',
                'Индивидуальное и глобальное техническое обслуживание',
                'Страница обслуживания для приложений',
              ]}
            />
          }
        />
        <Route
          path="analytics"
          element={
            <Planned
              title="Analytics"
              stage="этап 3"
              items={['Analytics SDK для приложений', 'Источники трафика, устройства, география', 'Аналитика по сервисам']}
            />
          }
        />
        <Route
          path="monitoring"
          element={
            <Planned
              title="Monitoring"
              stage="этап 4"
              items={['Серверные проверки доступности', 'История сбоев и uptime', 'Мониторинг Supabase']}
            />
          }
        />
        <Route
          path="users"
          element={<Planned title="Users" stage="этап 5" items={['Статистика зарегистрированных пользователей', 'Разбивка по сервисам']} />}
        />
        <Route
          path="logs"
          element={<Planned title="System Logs" stage="этап 5" items={['Единый журнал событий', 'Фильтры, поиск, детали события']} />}
        />
        <Route
          path="settings"
          element={<Planned title="Settings" stage="этап 5" items={['Общие настройки', 'Мониторинг, аналитика, уведомления, безопасность']} />}
        />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigError />;
  return (
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  );
}
