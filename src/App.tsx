import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { ToastProvider } from '@/components/ui/Toast';
import { Layout } from '@/components/layout/Layout';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import Profile from '@/pages/Profile';
import Monitoring from '@/pages/Monitoring';
import Users from '@/pages/Users';
import Logs from '@/pages/Logs';
import Settings from '@/pages/Settings';
import Services from '@/pages/Services';
import Analytics from '@/pages/Analytics';
import ServiceDetail from '@/pages/ServiceDetail';
import ResetPassword from '@/pages/ResetPassword';

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
  if (status === 'password_recovery') return <ResetPassword />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="services" element={<Services />} />
        <Route path="services/:slug" element={<ServiceDetail />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="users" element={<Users />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
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
