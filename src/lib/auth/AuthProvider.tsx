import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';

export interface AdminInfo {
  id: string;
  role: 'owner' | 'admin';
}

type Status = 'loading' | 'signed_out' | 'ready';

interface AuthState {
  status: Status;
  user: User | null;
  admin: AdminInfo | null;
  /** Сообщение для экрана входа (например, аккаунт без прав администратора). */
  notice: string | null;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NO_ACCESS = 'У этого аккаунта нет доступа к Control Center.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, admin: null, notice: null });

  const resolve = useCallback(async (session: Session | null, isFreshSignIn: boolean) => {
    if (!session) {
      setState((s) => ({ status: 'signed_out', user: null, admin: null, notice: s.notice }));
      return;
    }

    // Роль проверяется запросом к БД; доступ к строке ограничен RLS (только своя запись).
    const { data, error } = await supabase
      .from('cc_admin_users')
      .select('id, role')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();

    if (error || !data) {
      const notice = error ? `Не удалось проверить права доступа: ${error.message}` : NO_ACCESS;
      setState({ status: 'signed_out', user: null, admin: null, notice });
      await supabase.auth.signOut();
      return;
    }

    setState({ status: 'ready', user: session.user, admin: data as AdminInfo, notice: null });

    if (isFreshSignIn) {
      const key = `cc:login-logged:${session.user.id}`;
      try {
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          await supabase.rpc('cc_log_admin_login');
        }
      } catch {
        /* журнал входа не должен блокировать работу */
      }
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => void resolve(data.session, false));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Не вызываем async-запросы Supabase прямо внутри колбэка (риск взаимной блокировки).
      if (event === 'SIGNED_IN') setTimeout(() => void resolve(session, true), 0);
      else if (event === 'SIGNED_OUT') setTimeout(() => void resolve(null, false), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [resolve]);

  const signIn = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, notice: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message === 'Invalid login credentials' ? 'Неверный email или пароль.' : error.message;
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
