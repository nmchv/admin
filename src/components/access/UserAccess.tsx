import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import {
  fetchAccessProjects,
  fetchUserPermissions,
  revokeProjectAccess,
  setUserPermissionOverride,
  setUserRole,
} from '@/lib/supabase/api';
import { formatFullDateTime, fromLocalInput } from '@/utils/format';
import type { AccessProject, UserOverview, UserPermission, UserRole } from '@/types';
import { GrantAccessModal } from './GrantAccessModal';
import { ROLE_LABEL, SOURCE_LABEL, TONE_CLASS, accessState } from './labels';

type Grant = UserOverview['projects'][number];

function OverrideModal({
  userId,
  perm,
  allowed,
  onClose,
  onSaved,
}: {
  userId: string;
  perm: UserPermission;
  allowed: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState(perm.override_reason ?? '');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const untilError = until && new Date(until).getTime() <= Date.now() ? 'Срок должен быть в будущем.' : null;

  const save = async () => {
    setBusy(true);
    try {
      await setUserPermissionOverride({
        userId,
        permissionId: perm.permission_id,
        allowed,
        reason: reason.trim() || null,
        expires: fromLocalInput(until),
      });
      toast('success', allowed ? 'Право разрешено персонально' : 'Право запрещено персонально');
      onSaved();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось сохранить');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={allowed ? 'Разрешить персонально' : 'Запретить персонально'}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className={`btn ${allowed ? 'btn-primary' : 'btn-danger'}`} onClick={() => void save()} disabled={busy || Boolean(untilError)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {allowed ? 'Разрешить' : 'Запретить'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Право <span className="font-semibold text-fg">{perm.name}</span> <code className="text-xs">({perm.permission_key})</code>.
        Персональное исключение сильнее права роли.
      </p>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted">Причина (необязательно)</span>
        <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted">Действует до (необязательно)</span>
        <input className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} disabled={busy} />
        {untilError && <span className="text-xs text-bad">{untilError}</span>}
      </label>
    </Modal>
  );
}

/** Роль, доступ к сервисам и права конкретного пользователя — с возможностью менять прямо здесь. */
export function UserAccess({ overview, onChanged }: { overview: UserOverview; onChanged: () => void }) {
  const toast = useToast();
  const userId = overview.auth.id;
  const userLabel = overview.auth.email ?? overview.auth.phone ?? userId;
  const locked = overview.is_super_admin;

  const projects = useAsync(fetchAccessProjects, []);
  const perms = useAsync(() => fetchUserPermissions(userId), [userId]);

  const [grantFor, setGrantFor] = useState<AccessProject | null>(null);
  const [revokeFor, setRevokeFor] = useState<AccessProject | null>(null);
  const [override, setOverride] = useState<{ perm: UserPermission; allowed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);

  const grants = new Map<string, Grant>(overview.projects.map((g) => [g.project_id, g]));

  const refresh = () => {
    onChanged();
    projects.reload();
    perms.reload();
  };

  const changeRole = async (value: string) => {
    setRoleBusy(true);
    try {
      await setUserRole(userId, (value || null) as UserRole | null);
      toast('success', value ? `Роль: ${ROLE_LABEL[value as UserRole]}` : 'Роль снята');
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось изменить роль');
    } finally {
      setRoleBusy(false);
    }
  };

  const revoke = async () => {
    if (!revokeFor) return;
    setBusy(true);
    try {
      await revokeProjectAccess(userId, revokeFor.id);
      toast('success', `Доступ к «${revokeFor.name}» отозван`);
      setRevokeFor(null);
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось отозвать доступ');
    } finally {
      setBusy(false);
    }
  };

  const removeOverride = async (p: UserPermission) => {
    try {
      await setUserPermissionOverride({ userId, permissionId: p.permission_id, allowed: null, reason: null, expires: null });
      toast('success', 'Исключение снято — действует право роли');
      perms.reload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось снять исключение');
    }
  };

  const byService = new Map<string, UserPermission[]>();
  for (const p of perms.data ?? []) byService.set(p.service, [...(byService.get(p.service) ?? []), p]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <KeyRound className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-extrabold tracking-tight">Доступ и права</h2>
        {locked && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            <ShieldCheck className="h-3.5 w-3.5" /> Суперадминистратор: полный доступ, менять нельзя
          </span>
        )}
      </div>

      <div className="space-y-6 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-extrabold uppercase tracking-wide text-muted">Роль</span>
          <select
            className="input !w-auto"
            value={overview.role ?? ''}
            disabled={locked || roleBusy}
            onChange={(e) => void changeRole(e.target.value)}
            aria-label="Роль пользователя"
          >
            <option value="">Без роли</option>
            <option value="teacher">{ROLE_LABEL.teacher}</option>
            <option value="student">{ROLE_LABEL.student}</option>
          </select>
          {roleBusy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">Сервисы</h3>
          {projects.error ? (
            <ErrorState message={`${projects.error}. Примените миграцию 0007 в Supabase.`} onRetry={projects.reload} />
          ) : projects.loading ? (
            <Skeleton className="h-24" />
          ) : (projects.data ?? []).length === 0 ? (
            <EmptyState title="Сервисов нет" hint="В таблице projects пока нет записей." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <tbody className="divide-y divide-line">
                  {(projects.data ?? []).map((p) => {
                    const g = grants.get(p.id);
                    const st = accessState(g);
                    return (
                      <tr key={p.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{p.name}</div>
                          <div className="text-xs text-muted">
                            {p.slug} · {p.visibility === 'private' ? 'закрытый' : 'открытый'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[st.tone]}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {g ? (
                            <>
                              {g.access_level}
                              {g.expires_at && <> · до {formatFullDateTime(g.expires_at)}</>}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button className="btn !px-3 !py-1.5 !text-xs" disabled={locked} onClick={() => setGrantFor(p)}>
                              {g ? 'Изменить' : 'Выдать доступ'}
                            </button>
                            {g && (
                              <button className="btn !px-3 !py-1.5 !text-xs" disabled={locked} onClick={() => setRevokeFor(p)}>
                                Отозвать
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">Права</h3>
          <p className="mb-2 text-xs text-muted">
            Итог: персональное исключение → право роли → запрещено. Права ролей настраиваются на странице «Доступ».
          </p>
          {perms.error ? (
            <ErrorState message={`${perms.error}. Примените миграцию 0007 в Supabase.`} onRetry={perms.reload} />
          ) : perms.loading ? (
            <Skeleton className="h-24" />
          ) : byService.size === 0 ? (
            <EmptyState title="Каталог прав пуст" hint="Права (таблица permissions) создают сами сервисы." />
          ) : (
            <div className="space-y-4">
              {[...byService.entries()].map(([service, list]) => (
                <div key={service} className="overflow-x-auto rounded-xl border border-line">
                  <div className="border-b border-line bg-elevated/50 px-4 py-2 text-xs font-extrabold tracking-wide text-muted">{service}</div>
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <tbody className="divide-y divide-line">
                      {list.map((p) => {
                        const current = p.source === 'override' ? (p.override_allowed ? 'allow' : 'deny') : 'role';
                        return (
                          <tr key={p.permission_id}>
                            <td className="px-4 py-2.5">
                              <div className="font-semibold">{p.name}</div>
                              <code className="text-xs text-muted">{p.permission_key}</code>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.effective ? TONE_CLASS.ok : TONE_CLASS.none}`}>
                                {p.effective ? 'Разрешено' : 'Запрещено'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted">
                              {SOURCE_LABEL[p.source]}
                              {p.source === 'override' && p.override_reason && <> · {p.override_reason}</>}
                              {p.source === 'override' && p.override_expires_at && <> · до {formatFullDateTime(p.override_expires_at)}</>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <select
                                className="input !w-auto !py-1.5 !text-xs"
                                value={current}
                                disabled={locked}
                                aria-label={`Исключение для права ${p.name}`}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === 'role') void removeOverride(p);
                                  else setOverride({ perm: p, allowed: v === 'allow' });
                                }}
                              >
                                <option value="role">Как у роли</option>
                                <option value="allow">Разрешить</option>
                                <option value="deny">Запретить</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {grantFor && (
        <GrantAccessModal
          userId={userId}
          userLabel={userLabel}
          projectId={grantFor.id}
          projectName={grantFor.name}
          existing={grants.get(grantFor.id)}
          onClose={() => setGrantFor(null)}
          onSaved={() => {
            setGrantFor(null);
            refresh();
          }}
        />
      )}
      {revokeFor && (
        <ConfirmDialog
          title={`Отозвать доступ: ${revokeFor.name}`}
          confirmLabel="Отозвать"
          danger
          busy={busy}
          onConfirm={() => void revoke()}
          onClose={() => !busy && setRevokeFor(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            У пользователя <span className="text-fg">{userLabel}</span> пропадёт доступ к сервису. Выдать его можно снова в любой момент.
          </p>
        </ConfirmDialog>
      )}
      {override && (
        <OverrideModal
          userId={userId}
          perm={override.perm}
          allowed={override.allowed}
          onClose={() => setOverride(null)}
          onSaved={() => {
            setOverride(null);
            perms.reload();
          }}
        />
      )}
    </section>
  );
}
