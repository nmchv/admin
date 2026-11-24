import { useState } from 'react';
import { Hammer, RotateCcw, TriangleAlert } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useServices } from '@/lib/ServicesProvider';
import { setGlobalMaintenance } from '@/lib/supabase/api';
import { formatFullDateTime, fromLocalInput } from '@/utils/format';
import { MaintenanceFields, validateMaintenance } from './MaintenanceFields';

export function GlobalMaintenance() {
  const toast = useToast();
  const { rows, globalRow, loading, reload } = useServices();
  const [dialog, setDialog] = useState<'enable' | 'restore' | null>(null);
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);

  const active = Boolean(globalRow?.is_active);
  // Исключённые из глобального режима сервисы не затрагиваются.
  const affected = rows.filter((r) => !r.own?.exempt_from_global).length;
  const exempt = rows.length - affected;
  const noGuard = rows.filter((r) => !r.own?.exempt_from_global && r.guard === 'missing');
  const formError = dialog === 'enable' ? validateMaintenance(message, until) : null;

  const close = () => {
    if (busy) return;
    setDialog(null);
    setMessage('');
    setUntil('');
  };

  const run = async (enable: boolean) => {
    setBusy(true);
    try {
      const n = await setGlobalMaintenance({
        active: enable,
        message: enable ? message.trim() || null : null,
        until: enable ? fromLocalInput(until) : null,
      });
      toast('success', enable ? `Глобальное обслуживание включено (сервисов: ${n})` : 'Глобальное обслуживание снято');
      setBusy(false);
      setDialog(null);
      setMessage('');
      setUntil('');
      reload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось выполнить операцию');
      setBusy(false);
    }
  };

  return (
    <>
      <section
        className={`card flex flex-wrap items-center gap-4 p-4 sm:p-5 ${active ? '!border-maint/40 !bg-maint/5' : ''}`}
      >
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? 'bg-maint/15 text-maint' : 'bg-elevated text-muted'}`}>
          <Hammer className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold tracking-tight">
            Глобальное обслуживание: {loading ? '…' : active ? 'включено' : 'выключено'}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {active
              ? `${globalRow?.message ? `«${globalRow.message}» · ` : ''}${
                  globalRow?.scheduled_until ? `до ${formatFullDateTime(globalRow.scheduled_until)}` : 'срок не указан'
                }${exempt > 0 ? ` · исключено сервисов: ${exempt}` : ''}`
              : 'Переводит все сервисы в режим обслуживания одним действием. Отдельные сервисы можно исключить.'}
          </p>
        </div>
        {active ? (
          <button className="btn btn-primary" onClick={() => setDialog('restore')} disabled={loading}>
            <RotateCcw className="h-4 w-4" /> Restore All Services
          </button>
        ) : (
          <button className="btn btn-danger" onClick={() => setDialog('enable')} disabled={loading || !globalRow}>
            <Hammer className="h-4 w-4" /> Enable Maintenance for All Services
          </button>
        )}
      </section>

      {dialog === 'enable' && (
        <ConfirmDialog
          title="Включить обслуживание для всех сервисов"
          confirmLabel="Включить для всех"
          danger
          busy={busy}
          disabled={Boolean(formError)}
          onConfirm={() => void run(true)}
          onClose={close}
        >
          <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Все приложения будут заменены страницей «Ведутся технические работы», а их таблицы в базе данных закроются для
              пользователей до снятия режима. Будет затронуто сервисов: <b>{affected}</b>
              {exempt > 0 && ` (ещё ${exempt} исключено из глобального режима)`}.
            </p>
          </div>
          {noGuard.length > 0 && (
            <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Страница-заглушка не подтверждена на сайтах: <b>{noGuard.map((r) => r.service.name).join(', ')}</b>. Их базы
                данных закроются, но сами сайты продолжат открываться, пока на них не подключён{' '}
                <code className="text-fg">maintenance.js</code>.
              </p>
            </div>
          )}
          <MaintenanceFields message={message} until={until} onMessage={setMessage} onUntil={setUntil} disabled={busy} />
          {formError && <p className="text-xs text-bad">{formError}</p>}
        </ConfirmDialog>
      )}

      {dialog === 'restore' && (
        <ConfirmDialog
          title="Восстановить все сервисы"
          confirmLabel="Восстановить"
          busy={busy}
          onConfirm={() => void run(false)}
          onClose={close}
        >
          <p className="text-sm leading-relaxed text-muted">
            Глобальное обслуживание будет снято. Сервисы с собственным включённым режимом обслуживания останутся на
            обслуживании.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
