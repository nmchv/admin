import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/ServicesProvider';
import { useSettings, type SettingKey } from '@/lib/SettingsProvider';
import {
  fetchActivity,
  fetchAdmins,
  fetchHealthPaths,
  grantAdmin,
  revokeAdmin,
  rotateMonitorToken,
  setHealthPaths,
} from '@/lib/supabase/api';
import { formatDateTime, formatRelative } from '@/utils/format';

type Tab = 'general' | 'services' | 'analytics' | 'notifications' | 'security';
const TABS: { key: Tab; label: string }[] = [
  { key: 'general', label: 'Общие' },
  { key: 'services', label: 'Сервисы и мониторинг' },
  { key: 'analytics', label: 'Аналитика' },
  { key: 'notifications', label: 'Уведомления' },
  { key: 'security', label: 'Безопасность' },
];

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4 last:border-0">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-semibold">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function useSaver() {
  const settings = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (key: SettingKey, value: unknown) => {
    setBusy(key);
    try {
      await settings.save(key, value);
      settings.reload();
      toast('success', 'Настройка сохранена');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(null);
    }
  };
  return { save, busy };
}

function Toggle({ k, label, hint, s }: { k: SettingKey; label: string; hint?: string; s: ReturnType<typeof useSaver> }) {
  const settings = useSettings();
  const v = Boolean(settings.get(k));
  return (
    <Row title={label} hint={hint}>
      <button
        role="switch"
        aria-checked={v}
        disabled={s.busy === k}
        onClick={() => void s.save(k, !v)}
        className={`relative h-6 w-11 rounded-full border transition-colors ${v ? 'border-accent bg-accent' : 'border-line bg-elevated'} disabled:opacity-50`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${v ? 'left-[22px]' : 'left-1'}`} />
      </button>
    </Row>
  );
}

function Field({
  k, label, hint, s, type = 'text', min, max, suffix,
}: { k: SettingKey; label: string; hint?: string; s: ReturnType<typeof useSaver>; type?: 'text' | 'number'; min?: number; max?: number; suffix?: string }) {
  const settings = useSettings();
  const current = settings.get(k) as string | number;
  const [val, setVal] = useState(String(current));
  useEffect(() => setVal(String(current)), [current]);
  const parsed = type === 'number' ? Number(val) : val.trim();
  const invalid =
    type === 'number'
      ? !Number.isInteger(parsed) || (min != null && (parsed as number) < min) || (max != null && (parsed as number) > max)
      : val.trim().length === 0 || val.length > 80;
  const dirty = String(current) !== val;
  return (
    <Row title={label} hint={hint ?? (type === 'number' && min != null ? `От ${min} до ${max}` : undefined)}>
      <div className="flex items-center gap-2">
        <input
          className={`input ${type === 'number' ? '!w-28' : '!w-56'} ${invalid ? '!border-bad' : ''}`}
          type={type}
          value={val}
          min={min}
          max={max}
          onChange={(e) => setVal(e.target.value)}
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
        <button className="btn btn-primary" disabled={!dirty || invalid || s.busy === k} onClick={() => void s.save(k, parsed)}>
          {s.busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      </div>
    </Row>
  );
}

function General({ s }: { s: ReturnType<typeof useSaver> }) {
  const settings = useSettings();
  const tzs = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  })();
  const tz = settings.get('general.timezone');
  return (
    <div>
      <Field k="general.system_name" label="Название системы" s={s} />
      <Field k="general.ecosystem_name" label="Название экосистемы" s={s} />
      <Field k="general.main_domain" label="Основной домен" hint="Только для отображения." s={s} />
      <Row title="Часовой пояс" hint="Используется для часов в шапке.">
        <select className="input !w-60" value={tz} disabled={s.busy === 'general.timezone'} onChange={(e) => void s.save('general.timezone', e.target.value)}>
          {(tzs.includes(tz) ? tzs : [tz, ...tzs]).map((z) => <option key={z}>{z}</option>)}
        </select>
      </Row>
      <Row title="Язык интерфейса" hint="Пока доступен только русский.">
        <span className="rounded-full bg-elevated px-3 py-1 text-xs font-semibold">Русский</span>
      </Row>
    </div>
  );
}

function PathsEditor() {
  const { rows } = useServices();
  const toast = useToast();
  const paths = useAsync(fetchHealthPaths, []);
  const [sel, setSel] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const id = sel || rows[0]?.service.id || '';
  const saved = (paths.data?.[id] ?? ['/']).join('\n');
  useEffect(() => setText(saved), [saved, id]);
  const list = text.split('\n').map((x) => x.trim()).filter(Boolean);
  const invalid = list.length < 1 || list.length > 5 || list.some((p) => !p.startsWith('/') || p.length > 200 || /\s/.test(p));

  const submit = async () => {
    setBusy(true);
    try {
      await setHealthPaths(id, list);
      toast('success', 'Пути проверки сохранены');
      paths.reload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-4">
      <p className="text-sm font-semibold">Пути проверки сервиса</p>
      <p className="mt-0.5 text-xs text-muted">До 5 путей, по одному в строке, начинаются с «/». Адрес берётся из карточки сервиса. Сервис недоступен, если не отвечает хотя бы один путь.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select className="input !w-auto" value={id} onChange={(e) => setSel(e.target.value)} aria-label="Сервис">
          {rows.map((r) => <option key={r.service.id} value={r.service.id}>{r.service.name}</option>)}
        </select>
      </div>
      <textarea className={`input mt-2 h-24 font-mono text-xs ${invalid ? '!border-bad' : ''}`} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button className="btn btn-primary mt-2" disabled={invalid || busy || list.join('\n') === saved} onClick={() => void submit()}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить пути
      </button>
    </div>
  );
}

function TokenBlock() {
  const settings = useSettings();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { admin } = useAuth();
  const issued = settings.has('monitoring.token_hash');

  const rotate = async () => {
    setBusy(true);
    try {
      setToken(await rotateMonitorToken());
      setConfirm(false);
      settings.reload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось выпустить токен');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md">
          <p className="text-sm font-semibold">Токен монитора</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {issued ? 'Токен выпущен.' : 'Токен ещё не выпущен — монитор работать не будет.'} Хранится только хэш. Значение показывается один раз:
            добавьте его в GitHub → Settings → Secrets → <code className="text-fg">MONITOR_TOKEN</code>. Перевыпуск отключает старый токен.
          </p>
        </div>
        <button className="btn" disabled={admin?.role !== 'owner'} title={admin?.role !== 'owner' ? 'Только владелец' : undefined} onClick={() => setConfirm(true)}>
          <KeyRound className="h-4 w-4" /> {issued ? 'Перевыпустить' : 'Выпустить'}
        </button>
      </div>
      {token && (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn/10 p-3">
          <p className="text-xs font-semibold text-warn">Скопируйте сейчас — больше он показан не будет.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-bg p-2 text-xs">{token}</code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(token).then(() => setCopied(true));
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <button className="btn" onClick={() => { setToken(null); setCopied(false); }}>Готово</button>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title={issued ? 'Перевыпустить токен?' : 'Выпустить токен?'} confirmLabel="Выпустить" danger={issued} busy={busy} onConfirm={() => void rotate()} onClose={() => !busy && setConfirm(false)}>
          <p className="text-sm leading-relaxed text-muted">
            {issued ? 'Предыдущий токен перестанет работать, пока вы не обновите секрет MONITOR_TOKEN в GitHub.' : 'Будет создан секретный токен для GitHub Actions.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Security() {
  const { admin, user } = useAuth();
  const toast = useToast();
  const admins = useAsync(fetchAdmins, []);
  const logins = useAsync(() => fetchActivity({ from: null, to: null, actionPrefix: 'login', asc: false, page: 0, pageSize: 10 }), []);
  const isOwner = admin?.role === 'owner';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [revoke, setRevoke] = useState<{ id: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      admins.reload();
      setConfirmGrant(false);
      setRevoke(null);
      setEmail('');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Операция не выполнена');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-bg/50 p-4 text-xs leading-relaxed text-muted">
        <p className="mb-1 flex items-center gap-2 font-semibold text-fg"><ShieldCheck className="h-4 w-4 text-ok" /> Как устроена защита</p>
        Публичной регистрации администраторов нет. Все изменения идут через серверные функции с проверкой роли; ключ service_role в браузере не используется.
        Администратором можно сделать только того, кто уже зарегистрирован в Supabase Auth (создайте пользователя в панели Supabase → Authentication).
      </div>

      <section>
        <h3 className="mb-2 text-sm font-extrabold">Администраторы</h3>
        {admins.loading ? <Skeleton className="h-20" /> : admins.error ? <ErrorState message={admins.error} onRetry={admins.reload} /> : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {(admins.data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.email}{a.auth_user_id === user?.id && <span className="ml-2 text-xs text-muted">(вы)</span>}</p>
                  <p className="text-xs text-muted">Последний вход: {a.last_sign_in_at ? formatRelative(a.last_sign_in_at) : 'нет данных'} · с {formatDateTime(a.created_at)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${a.role === 'owner' ? 'bg-accent/10 text-accent' : 'bg-elevated text-muted'}`}>{a.role === 'owner' ? 'Владелец' : 'Админ'}</span>
                {isOwner && a.auth_user_id !== user?.id && (
                  <button className="btn !px-2.5" aria-label="Отозвать доступ" onClick={() => setRevoke({ id: a.id, email: a.email })}>
                    <Trash2 className="h-4 w-4 text-bad" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner ? (
        <section>
          <h3 className="mb-2 text-sm font-extrabold">Выдать доступ</h3>
          <div className="flex flex-wrap gap-2">
            <input className="input !w-72" type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            <select className="input !w-auto" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'owner')}>
              <option value="admin">Админ</option>
              <option value="owner">Владелец</option>
            </select>
            <button className="btn btn-primary" disabled={!emailOk} onClick={() => setConfirmGrant(true)}><UserPlus className="h-4 w-4" /> Выдать</button>
          </div>
        </section>
      ) : (
        <p className="text-xs text-muted">Управлять администраторами может только владелец.</p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-extrabold">Последние входы</h3>
        {logins.loading ? <Skeleton className="h-16" /> : logins.error ? <ErrorState message={logins.error} onRetry={logins.reload} /> : !logins.data || logins.data.rows.length === 0 ? (
          <EmptyState title="Входов пока не записано" />
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {logins.data.rows.map((l) => {
              const a = admins.data?.find((x) => x.id === l.admin_id);
              return <li key={l.id} className="px-4 py-2.5">{a?.email ?? 'администратор'} <span className="text-xs text-muted">· {formatDateTime(l.created_at)}</span></li>;
            })}
          </ul>
        )}
      </section>

      {confirmGrant && (
        <ConfirmDialog title="Выдать доступ?" confirmLabel="Выдать" danger={role === 'owner'} busy={busy} onConfirm={() => void run(() => grantAdmin(email.trim(), role), 'Доступ выдан')} onClose={() => !busy && setConfirmGrant(false)}>
          <p className="text-sm leading-relaxed text-muted">{email.trim()} получит роль «{role === 'owner' ? 'Владелец' : 'Админ'}».{role === 'owner' && ' Владелец может управлять другими администраторами.'}</p>
        </ConfirmDialog>
      )}
      {revoke && (
        <ConfirmDialog title="Отозвать доступ?" confirmLabel="Отозвать" danger busy={busy} onConfirm={() => void run(() => revokeAdmin(revoke.id), 'Доступ отозван')} onClose={() => !busy && setRevoke(null)}>
          <p className="text-sm leading-relaxed text-muted">{revoke.email} потеряет доступ к Control Center. Аккаунт в Supabase Auth останется.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default function Settings() {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('general');
  const s = useSaver();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap rounded-xl border border-line bg-surface p-0.5 sm:w-fit" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded-[10px] px-4 py-1.5 text-xs font-semibold ${tab === t.key ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {settings.error ? (
        <div className="card"><ErrorState message={settings.error} onRetry={settings.reload} /></div>
      ) : (
        <section className="card p-5">
          {tab === 'general' && <General s={s} />}
          {tab === 'services' && (
            <>
              <Field k="monitoring.interval_minutes" label="Интервал проверок" type="number" min={5} max={1440} suffix="мин" hint="Не чаще 5 минут: ограничение расписания GitHub Actions. Монитор пропускает запуски, пока интервал не истёк." s={s} />
              <Field k="monitoring.slow_ms" label="Порог «медленного» ответа" type="number" min={100} max={60000} suffix="мс" hint="Ответ медленнее порога — статус «С ограничениями»." s={s} />
              <Field k="monitoring.timeout_ms" label="Таймаут запроса" type="number" min={1000} max={30000} suffix="мс" hint="Нет ответа за это время — проверка считается неуспешной." s={s} />
              <Field k="monitoring.retention_days" label="Хранить историю проверок" type="number" min={7} max={3650} suffix="дн" s={s} />
              <TokenBlock />
              <PathsEditor />
            </>
          )}
          {tab === 'analytics' && (
            <>
              <Toggle k="analytics.enabled" label="Приём событий аналитики" hint="Выключение останавливает запись новых событий; собранные данные сохраняются." s={s} />
              <Field k="analytics.retention_days" label="Срок хранения событий" type="number" min={0} max={3650} suffix="дн" hint="0 — хранить без ограничения." s={s} />
            </>
          )}
          {tab === 'notifications' && (
            <>
              <p className="mb-2 text-xs leading-relaxed text-muted">Уведомления показываются в колокольчике в шапке панели. Отправка на e-mail и в мессенджеры пока не реализована (запланировано).</p>
              <Toggle k="notifications.down" label="Недоступность и медленная работа" s={s} />
              <Toggle k="notifications.recovered" label="Восстановление сервиса" s={s} />
              <Toggle k="notifications.errors" label="Ошибки мониторинга" s={s} />
              <Toggle k="notifications.settings_changed" label="Изменения настроек и обслуживания" s={s} />
            </>
          )}
          {tab === 'security' && <Security />}
        </section>
      )}
    </div>
  );
}
