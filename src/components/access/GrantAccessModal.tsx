import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Loader2 } from 'lucide-react';
import { grantProjectAccess } from '@/lib/supabase/api';
import { fromLocalInput, toLocalInput } from '@/utils/format';

interface Props {
  userId: string;
  /** Подпись пользователя в заголовке (e-mail или имя). */
  userLabel: string;
  projectId: string;
  projectName: string;
  /** Текущая выдача — тогда окно работает как «Изменить». */
  existing?: { access_level: string; is_active: boolean; expires_at: string | null };
  onClose: () => void;
  onSaved: () => void;
}

/** Выдать или изменить доступ пользователя к сервису. */
export function GrantAccessModal({ userId, userLabel, projectId, projectName, existing, onClose, onSaved }: Props) {
  const toast = useToast();
  const [level, setLevel] = useState(existing?.access_level ?? 'member');
  const [active, setActive] = useState(existing?.is_active ?? true);
  const [until, setUntil] = useState(toLocalInput(existing?.expires_at ?? null));
  const [busy, setBusy] = useState(false);

  const untilError = until && new Date(until).getTime() <= Date.now() ? 'Срок должен быть в будущем.' : null;
  const levelError = level.trim().length > 40 ? 'Не длиннее 40 символов.' : null;

  const save = async () => {
    setBusy(true);
    try {
      await grantProjectAccess({
        userId,
        projectId,
        level: level.trim() || 'member',
        expires: fromLocalInput(until),
        active,
      });
      toast('success', existing ? 'Доступ обновлён' : `Доступ к «${projectName}» выдан`);
      onSaved();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось сохранить доступ');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Доступ: ${projectName}` : `Выдать доступ: ${projectName}`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || Boolean(untilError || levelError)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {existing ? 'Сохранить' : 'Выдать доступ'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Пользователь: <span className="font-semibold text-fg">{userLabel}</span>
      </p>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted">Уровень доступа</span>
        <input className="input" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="member" disabled={busy} />
        {levelError && <span className="text-xs text-bad">{levelError}</span>}
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted">Действует до (необязательно)</span>
        <input className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} disabled={busy} />
        {untilError ? (
          <span className="text-xs text-bad">{untilError}</span>
        ) : (
          <span className="text-xs text-muted">Пусто — без ограничения по сроку.</span>
        )}
      </label>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[#5B8DEF]" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} />
        Доступ включён
      </label>
    </Modal>
  );
}
