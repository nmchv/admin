import { useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function Login() {
  const { signIn, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(email.trim(), password);
    if (err) setError(err);
    setBusy(false);
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
      </form>
    </div>
  );
}
