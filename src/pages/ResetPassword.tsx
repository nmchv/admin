import { useState, type FormEvent } from 'react';
import { Loader2, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function ResetPassword() {
  const { status, updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validate = () => {
    if (password.length < 8) return 'Пароль должен содержать минимум 8 символов.';
    if (password !== confirmPassword) return 'Пароли не совпадают.';
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    const updateErr = await updatePassword(password);
    if (updateErr) {
      setError(updateErr);
      setBusy(false);
      return;
    }
    setSuccess(true);
    setBusy(false);
    // Redirect to login after a short delay
    setTimeout(() => void signOut(), 2000);
  };

  if (status !== 'password_recovery') {
    return null;
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="card w-full max-w-sm space-y-5 p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated">
            <Lock className="h-4 w-4 text-accent" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight">nmchv Control Center</h1>
            <p className="text-xs text-muted">Установка нового пароля</p>
          </div>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-good/10">
              <CheckCircle className="h-6 w-6 text-good" />
            </div>
            <p className="text-sm font-semibold">Пароль успешно изменён</p>
            <p className="text-xs text-muted">Перенаправление на страницу входа&hellip;</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted">Новый пароль</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted">Подтверждение пароля</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={busy}
              />
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs leading-snug text-bad">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button className="btn btn-primary w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Сохранить пароль
            </button>
          </form>
        )}
      </div>
    </div>
  );
}