import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function Profile() {
  const { user, admin, signOut } = useAuth();
  return (
    <div className="card mx-auto mt-2 max-w-xl divide-y divide-line">
      <dl className="space-y-4 p-5 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Email</dt>
          <dd className="mt-1 break-all font-semibold">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Роль</dt>
          <dd className="mt-1 font-semibold">{admin?.role === 'owner' ? 'Владелец' : 'Администратор'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Последний вход</dt>
          <dd className="mt-1 font-semibold">
            {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('ru-RU') : '—'}
          </dd>
        </div>
      </dl>
      <div className="p-5">
        <button className="btn" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" /> Выйти
        </button>
      </div>
    </div>
  );
}
