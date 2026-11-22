import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { saveService } from '@/lib/supabase/api';
import type { Service } from '@/types';

const SLUG_RE = /^[a-z0-9_-]+$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Принимает owner/repo или полный URL GitHub, возвращает owner/repo. */
function normalizeRepo(v: string): string {
  return v.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
}

interface Props {
  /** null — создание нового сервиса. */
  service: Service | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function ServiceFormDialog({ service, onClose, onSaved }: Props) {
  const toast = useToast();
  const [slug, setSlug] = useState(service?.slug ?? '');
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [url, setUrl] = useState(service?.url ?? '');
  const [repo, setRepo] = useState(service?.github_repository ?? '');
  const [enabled, setEnabled] = useState(service?.is_enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!service && !SLUG_RE.test(slug.trim().toLowerCase())) return 'Идентификатор: латиница, цифры, «_» и «-».';
    if (!name.trim()) return 'Укажите название.';
    if (url.trim() && !/^https?:\/\/\S+$/i.test(url.trim())) return 'URL должен начинаться с http:// или https://.';
    if (repo.trim() && !REPO_RE.test(normalizeRepo(repo))) return 'Репозиторий в формате owner/repo.';
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) return setError(v);
    setBusy(true);
    setError(null);
    try {
      const id = await saveService({
        id: service?.id ?? null,
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        description: description.trim() || null,
        url: url.trim() || null,
        github: repo.trim() ? normalizeRepo(repo) : null,
        isEnabled: enabled,
      });
      toast('success', service ? 'Настройки сервиса сохранены' : 'Сервис зарегистрирован');
      onSaved(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить сервис');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={service ? `Настройки: ${service.name}` : 'Новый сервис'}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" form="service-form" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted">
            Идентификатор{service && ' (не меняется — по нему работают приложения)'}
          </span>
          <input
            className="input"
            value={slug}
            disabled={Boolean(service) || busy}
            placeholder="my_service"
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted">Название</span>
          <input className="input" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted">Описание</span>
          <textarea
            className="input min-h-[64px] resize-y"
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted">URL сайта (нужен для мониторинга)</span>
          <input
            className="input"
            value={url}
            disabled={busy}
            placeholder="https://…"
            inputMode="url"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted">GitHub-репозиторий</span>
          <input
            className="input"
            value={repo}
            disabled={busy}
            placeholder="nmchv/repository"
            onChange={(e) => setRepo(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#5B8DEF]"
          />
          Сервис включён в реестр
        </label>
        {error && (
          <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
