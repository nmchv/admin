import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, ExternalLink, Github, Hammer, Loader2, Pencil, RotateCcw, ScrollText, TriangleAlert } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Modal';
import { MaintenanceFields, validateMaintenance } from '@/components/services/MaintenanceFields';
import { ServiceFormDialog } from '@/components/services/ServiceFormDialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/lib/ServicesProvider';
import { fetchServiceLogs, setServiceMaintenance } from '@/lib/supabase/api';
import {
  formatDateTime,
  formatFullDateTime,
  formatNumber,
  formatRelative,
  fromLocalInput,
  toLocalInput,
} from '@/utils/format';

export default function ServiceDetail() {
  const { slug } = useParams();
  const toast = useToast();
  const { rows, globalRow, loading, error, reload } = useServices();
  const row = rows.find((r) => r.service.slug === slug);

  const logs = useAsync(
    () => (row ? fetchServiceLogs(row.service.id, 20) : Promise.resolve([])),
    [row?.service.id],
  );

  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const [exempt, setExempt] = useState(false);
  const [confirm, setConfirm] = useState<'enable' | 'disable' | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  // Форма синхронизируется с сохранённым состоянием при каждом его изменении.
  const syncKey = row?.own?.updated_at ?? row?.service.id;
  useEffect(() => {
    setMessage(row?.own?.message ?? '');
    setUntil(toLocalInput(row?.own?.scheduled_until ?? null));
    setExempt(row?.own?.exempt_from_global ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  if (error) {
    return (
      <div className="card">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  if (loading) return <Skeleton className="h-[480px] w-full" />;
  if (!row) {
    return (
      <div className="card">
        <EmptyState title="Сервис не найден" hint={`В реестре нет сервиса «${slug}».`} />
        <div className="pb-8 text-center">
          <Link to="/services" className="btn">
            <ArrowLeft className="h-4 w-4" /> К списку сервисов
          </Link>
        </div>
      </div>
    );
  }

  const { service, status, maintenance, own } = row;
  const individualActive = Boolean(own?.is_active);
  const globalActive = Boolean(globalRow?.is_active);
  const underGlobal = globalActive && !own?.exempt_from_global;
  const formError = validateMaintenance(message, until);
  const exemptChanged = exempt !== (own?.exempt_from_global ?? false);

  const apply = async (active: boolean, okText: string) => {
    setBusy(true);
    try {
      await setServiceMaintenance({
        serviceId: service.id,
        active,
        message: message.trim() || null,
        until: fromLocalInput(until),
        exempt,
      });
      toast('success', okText);
      setConfirm(null);
      reload();
      logs.reload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось выполнить операцию');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (formError) return toast('error', formError);
    void apply(individualActive, 'Настройки обслуживания сохранены');
  };

  const info: [string, string][] = [
    ['Идентификатор', service.slug],
    ['URL', service.url ?? 'не указан'],
    ['Репозиторий', service.github_repository ?? 'не указан'],
    ['Последняя проверка', formatRelative(row.lastCheckedAt)],
    ['Время ответа', row.responseTime != null ? `${row.responseTime} мс` : 'нет данных'],
    ['Обновлён', formatDateTime(row.updatedAt)],
  ];

  return (
    <div className="space-y-6">
      <Link to="/services" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Все сервисы
      </Link>

      <section className="card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-extrabold tracking-tight">{service.name}</h2>
              <StatusBadge status={status} />
              {!service.is_enabled && (
                <span className="rounded-full bg-idle/10 px-2.5 py-1 text-xs font-semibold text-muted">Отключён в реестре</span>
              )}
            </div>
            {service.description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{service.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Изменить
            </button>
            <button className="btn" disabled title="Проверка доступности появится на этапе 4 (мониторинг)">
              <Activity className="h-4 w-4" /> Проверить доступность
            </button>
            {service.url && (
              <a className="btn" href={service.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Сайт
              </a>
            )}
            {service.github_repository && (
              <a className="btn" href={`https://github.com/${service.github_repository}`} target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" /> GitHub
              </a>
            )}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 text-sm md:grid-cols-3">
          {info.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-semibold text-muted">{k}</dt>
              <dd className="mt-0.5 truncate font-semibold" title={v}>
                {v}
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-xs font-semibold text-muted">Посетители за сутки</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatNumber(row.visitors24h)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">Подробная статистика по сервису появится в разделе Analytics (этап 3).</p>
      </section>

      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className={`grid h-9 w-9 place-items-center rounded-xl ${maintenance ? 'bg-maint/15 text-maint' : 'bg-elevated text-muted'}`}>
            <Hammer className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold tracking-tight">Техническое обслуживание</h3>
            <p className="text-xs text-muted">
              {maintenance
                ? maintenance.source === 'global'
                  ? 'Действует глобальное обслуживание'
                  : 'Включено индивидуальное обслуживание'
                : 'Сервис работает в штатном режиме'}
              {maintenance?.until && ` · до ${formatFullDateTime(maintenance.until)}`}
            </p>
          </div>
        </div>

        {underGlobal && (
          <div className="mb-4 flex gap-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Включено глобальное обслуживание: оно приоритетнее индивидуального, а его сообщение показывается
              пользователям. Чтобы вывести этот сервис из глобального режима, включите исключение ниже и сохраните.
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <MaintenanceFields message={message} until={until} onMessage={setMessage} onUntil={setUntil} disabled={busy} />
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[#5B8DEF]"
            checked={exempt}
            disabled={busy}
            onChange={(e) => setExempt(e.target.checked)}
          />
          <span>
            Исключить из глобального обслуживания
            <span className="block text-xs text-muted">Сервис продолжит работать, даже когда включён глобальный режим.</span>
          </span>
        </label>

        {formError && <p className="mt-3 text-xs text-bad">{formError}</p>}

        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {individualActive ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm('disable')}>
              <RotateCcw className="h-4 w-4" /> Выключить обслуживание
            </button>
          ) : (
            <button className="btn btn-danger" disabled={busy || Boolean(formError)} onClick={() => setConfirm('enable')}>
              <Hammer className="h-4 w-4" /> Включить обслуживание
            </button>
          )}
          <button
            className="btn"
            disabled={busy || Boolean(formError) || (!individualActive && !exemptChanged && !message && !until)}
            onClick={save}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить настройки
          </button>
        </div>
      </section>

      <section className="card">
        <div className="border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-extrabold tracking-tight">События сервиса</h3>
        </div>
        {logs.loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.reload} />
        ) : !logs.data || logs.data.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Событий пока нет" />
        ) : (
          <ul className="divide-y divide-line">
            {logs.data.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <p className="text-sm leading-snug">{e.message}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatDateTime(e.created_at)} · {e.category}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirm === 'enable' && (
        <ConfirmDialog
          title={`Включить обслуживание: ${service.name}`}
          confirmLabel="Включить"
          danger
          busy={busy}
          onConfirm={() => void apply(true, `«${service.name}» переведён в режим обслуживания`)}
          onClose={() => !busy && setConfirm(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            Пользователи увидят страницу «Ведутся технические работы» вместо приложения.
            {message.trim() && (
              <>
                {' '}
                Сообщение: <span className="text-fg">«{message.trim()}»</span>.
              </>
            )}
          </p>
        </ConfirmDialog>
      )}

      {confirm === 'disable' && (
        <ConfirmDialog
          title={`Выключить обслуживание: ${service.name}`}
          confirmLabel="Выключить"
          busy={busy}
          onConfirm={() => void apply(false, `«${service.name}» выведен из режима обслуживания`)}
          onClose={() => !busy && setConfirm(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            Индивидуальное обслуживание будет снято.
            {underGlobal && ' Сервис всё равно останется на обслуживании, пока действует глобальный режим.'}
          </p>
        </ConfirmDialog>
      )}

      {editing && (
        <ServiceFormDialog
          service={service}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
            logs.reload();
          }}
        />
      )}
    </div>
  );
}
