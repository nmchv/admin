import { useState, type FormEvent } from 'react';
import { Loader2, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function Login() {
  const { signIn, notice, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(email.trim(), password);
    if (err) setError(err);
    setBusy(false);
  };

  const handleResetRequest = async (e: FormEvent) => {
    e.preventDefault();
    setResetBusy(true);
    setResetMessage(null);
    const err = await requestPasswordReset(resetEmail.trim());
    if (err) setResetMessage(err);
    else setResetMessage('Если аккаунт существует, письмо со ссылкой для восстановления отправлено.');
    setResetBusy(false);
  };

  const message = error ?? notice;

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated">
            <Lock className="h-4 w-4 text-accent" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight">nmchv Control Center</h1>
            <p className="text-xs text-muted">Доступ только для администраторов</p>
          </div>
        </div>

        {!showReset ? (
          <>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted">Email</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted">Пароль</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {message && (
              <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs leading-snug text-bad">
                {message}
              </p>
            )}

            <button className="btn btn-primary w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Войти
            </button>

            <button
              type="button"
              onClick={() => setShowReset(true)}
              className="btn btn-ghost w-full text-xs"
            >
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Забыли пароль?
            </button>
          </>
        ) : (
          <form onSubmit={handleResetRequest} className="space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-sm font-extrabold">Восстановление пароля</h2>
              <p className="text-xs text-muted">
                Введите email администратора — пришлём ссылку для смены пароля
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted">Email</span>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <input
                  className="input pl-9"
                  type="email"
                  autoComplete="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
              </div>
            </label>

            {resetMessage && (
              <p
                role="alert"
                className={`rounded-xl border px-3 py-2 text-xs leading-snug ${
                  resetMessage.startsWith('Если') ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'
                }`}
              >
                {resetMessage}
              </p>
            )}

            <button className="btn btn-primary w-full" disabled={resetBusy}>
              {resetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Отправить ссылку
            </button>

            <button
              type="button"
              onClick={() => setShowReset(false)}
              className="btn btn-ghost w-full text-xs"
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              Вернуться к входу
            </button>
          </form>
        )}
      </form>
    </div>
  );
}
