import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Info, Search, UserPlus } from 'lucide-react';
import { GrantAccessModal } from '@/components/access/GrantAccessModal';
import { ROLE_LABEL, TONE_CLASS, accessState } from '@/components/access/labels';
import { UserPicker } from '@/components/access/UserPicker';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  fetchAccessProjects,
  fetchPermissionsCatalog,
  fetchProjectGrants,
  revokeProjectAccess,
  setRolePermission,
} from '@/lib/supabase/api';
import { formatFullDateTime, formatNumber } from '@/utils/format';
import type { AccessProject, PermissionCatalogRow, ProjectGrant, UserListRow, UserRole } from '@/types';

const PAGE = 25;
type Tab = 'services' | 'roles';

function ServicesTab() {
  const toast = useToast();
  const projects = useAsync(fetchAccessProjects, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<UserListRow | null>(null);
  const [edit, setEdit] = useState<ProjectGrant | null>(null);
  const [revoke, setRevoke] = useState<ProjectGrant | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = projects.data ?? [];
  const project: AccessProject | undefined = list.find((p) => p.id === selectedId) ?? list[0];

  const grants = useAsync(
    () => (project ? fetchProjectGrants({ projectId: project.id, q: debounced, limit: PAGE, offset: page * PAGE }) : Promise.resolve([])),
    [project?.id, debounced, page],
  );
  const rows = grants.data ?? [];
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const refresh = () => {
    projects.reload();
    grants.reload();
  };

  const doRevoke = async () => {
    if (!revoke || !project) return;
    setBusy(true);
    try {
      await revokeProjectAccess(revoke.user_id, project.id);
      toast('success', 'Доступ отозван');
      setRevoke(null);
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось отозвать доступ');
    } finally {
      setBusy(false);
    }
  };

  if (projects.error) {
    return (
      <div className="card">
        <ErrorState message={`${projects.error}. Примените миграцию 0007 в Supabase.`} onRetry={projects.reload} />
      </div>
    );
  }
  if (projects.loading && !projects.data) return <Skeleton className="h-64" />;
  if (list.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Сервисов нет" hint="Добавьте записи в таблицу projects — тогда ими можно управлять отсюда." />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="card h-fit overflow-hidden">
        <ul className="divide-y divide-line">
          {list.map((p) => (
            <li key={p.id}>
              <button
                className={`w-full px-4 py-3 text-left transition-colors hover:bg-elevated/60 ${p.id === project?.id ? 'bg-elevated' : ''}`}
                onClick={() => {
                  setSelectedId(p.id);
                  setPage(0);
                  setQ('');
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-muted">{formatNumber(p.active_users)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {p.slug} · {p.visibility === 'private' ? 'закрытый' : 'открытый'}
                  {p.status !== 'available' && ` · ${p.status}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {project && (
        <div className="space-y-4">
          <section className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-sm font-extrabold tracking-tight">Выдать доступ к «{project.name}»</h2>
              <a href={project.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg">
                Открыть сайт <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <UserPicker onPick={setPicked} />
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
              <h2 className="mr-auto text-sm font-extrabold tracking-tight">
                Есть доступ
                <span className="ml-2 font-semibold text-muted">
                  {formatNumber(project.active_users)} активных · {formatNumber(project.total_grants)} всего
                </span>
              </h2>
              <label className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input className="input !pl-9" placeholder="Поиск среди выданных" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>

            {grants.error ? (
              <ErrorState message={grants.error} onRetry={grants.reload} />
            ) : grants.loading && !grants.data ? (
              <div className="p-4">
                <Skeleton className="h-32" />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<UserPlus className="h-6 w-6" />}
                title={debounced ? 'Никого не нашли' : 'Доступ пока никому не выдан'}
                hint={debounced ? undefined : 'Найдите пользователя выше и выдайте ему доступ.'}
              />
            ) : (
              <div className={`overflow-x-auto ${grants.loading ? 'opacity-60' : ''}`}>
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-5 py-2.5 font-semibold">Пользователь</th>
                      <th className="px-4 py-2.5 font-semibold">Роль</th>
                      <th className="px-4 py-2.5 font-semibold">Состояние</th>
                      <th className="px-4 py-2.5 font-semibold">Уровень / срок</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((g) => {
                      const st = accessState(g);
                      return (
                        <tr key={g.user_id}>
                          <td className="px-5 py-3">
                            <Link to={`/users/${g.user_id}`} className="font-semibold hover:text-accent">
                              {g.display_name || g.email || g.user_id}
                            </Link>
                            <div className="text-xs text-muted">{g.email ?? '—'}</div>
                          </td>
                          <td className="px-4 py-3 text-muted">{g.role ? ROLE_LABEL[g.role] : '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[st.tone]}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted">
                            {g.access_level}
                            {g.expires_at && <> · до {formatFullDateTime(g.expires_at)}</>}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button className="btn !px-3 !py-1.5 !text-xs" onClick={() => setEdit(g)}>
                                Изменить
                              </button>
                              <button className="btn !px-3 !py-1.5 !text-xs" onClick={() => setRevoke(g)}>
                                Отозвать
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {total > PAGE && (
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
                <span>
                  Страница {page + 1} из {pages}
                </span>
                <div className="flex gap-2">
                  <button className="btn !px-2.5 !py-1.5" disabled={page === 0 || grants.loading} onClick={() => setPage((p) => p - 1)} aria-label="Назад">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button className="btn !px-2.5 !py-1.5" disabled={page + 1 >= pages || grants.loading} onClick={() => setPage((p) => p + 1)} aria-label="Вперёд">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {project && picked && (
        <GrantAccessModal
          userId={picked.user_id}
          userLabel={picked.email ?? picked.display_name ?? picked.user_id}
          projectId={project.id}
          projectName={project.name}
          onClose={() => setPicked(null)}
          onSaved={() => {
            setPicked(null);
            refresh();
          }}
        />
      )}
      {project && edit && (
        <GrantAccessModal
          userId={edit.user_id}
          userLabel={edit.email ?? edit.display_name ?? edit.user_id}
          projectId={project.id}
          projectName={project.name}
          existing={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            refresh();
          }}
        />
      )}
      {revoke && (
        <ConfirmDialog
          title="Отозвать доступ"
          confirmLabel="Отозвать"
          danger
          busy={busy}
          onConfirm={() => void doRevoke()}
          onClose={() => !busy && setRevoke(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            У пользователя <span className="text-fg">{revoke.email ?? revoke.user_id}</span> пропадёт доступ к «{project?.name}». Выдать его можно снова.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function RolesTab() {
  const toast = useToast();
  const { admin } = useAuth();
  const isOwner = admin?.role === 'owner';
  const catalog = useAsync(fetchPermissionsCatalog, []);
  const [pending, setPending] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const toggle = async (p: PermissionCatalogRow, role: UserRole, next: boolean) => {
    const key = `${p.id}:${role}`;
    setPending(key);
    setOverrides((o) => ({ ...o, [key]: next }));
    try {
      await setRolePermission(role, p.id, next);
      toast('success', `${ROLE_LABEL[role]}: «${p.name}» ${next ? 'разрешено' : 'запрещено'}`);
      catalog.reload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось изменить право');
    } finally {
      setOverrides((o) => {
        const { [key]: _drop, ...rest } = o;
        return rest;
      });
      setPending(null);
    }
  };

  if (catalog.error) {
    return (
      <div className="card">
        <ErrorState message={`${catalog.error}. Примените миграцию 0007 в Supabase.`} onRetry={catalog.reload} />
      </div>
    );
  }
  if (catalog.loading && !catalog.data) return <Skeleton className="h-64" />;

  const byService = new Map<string, PermissionCatalogRow[]>();
  for (const p of catalog.data ?? []) byService.set(p.service, [...(byService.get(p.service) ?? []), p]);

  if (byService.size === 0) {
    return (
      <div className="card">
        <EmptyState title="Каталог прав пуст" hint="Права — это записи таблицы permissions. Их создают сервисы; здесь вы выбираете, какие из них даёт каждая роль." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Права роли действуют на всех пользователей с этой ролью. Для одного человека права можно переопределить в его карточке
          (персональное исключение сильнее роли).{' '}
          {isOwner ? 'Изменения применяются сразу.' : 'Менять права ролей может только владелец (owner) — у вас режим просмотра.'}
        </p>
      </div>

      {[...byService.entries()].map(([service, list]) => (
        <section key={service} className="card overflow-hidden">
          <div className="border-b border-line bg-elevated/50 px-5 py-2.5 text-xs font-extrabold tracking-wide text-muted">{service}</div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-semibold">Право</th>
                <th className="w-28 px-4 py-2.5 text-center font-semibold">{ROLE_LABEL.teacher}</th>
                <th className="w-28 px-4 py-2.5 text-center font-semibold">{ROLE_LABEL.student}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3">
                    <div className="font-semibold">{p.name}</div>
                    <code className="text-xs text-muted">{p.permission_key}</code>
                    {p.description && <div className="mt-0.5 text-xs text-muted">{p.description}</div>}
                  </td>
                  {(['teacher', 'student'] as const).map((role) => {
                    const key = `${p.id}:${role}`;
                    const value = overrides[key] ?? p[role];
                    return (
                      <td key={role} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#5B8DEF]"
                          checked={value}
                          disabled={!isOwner || pending === key}
                          aria-label={`${ROLE_LABEL[role]}: ${p.name}`}
                          onChange={(e) => void toggle(p, role, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export default function Access() {
  const [tab, setTab] = useState<Tab>('services');
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(
          [
            ['services', 'Доступ к сервисам'],
            ['roles', 'Права ролей'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`btn !px-4 !py-2 ${tab === id ? '!border-accent/60 !text-accent' : ''}`}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'services' ? <ServicesTab /> : <RolesTab />}
    </div>
  );
}
