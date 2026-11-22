/** Общие поля «сообщение + предполагаемое время восстановления» для индивидуального и глобального режима. */
export const MESSAGE_LIMIT = 500;

interface Props {
  message: string;
  until: string;
  onMessage: (v: string) => void;
  onUntil: (v: string) => void;
  disabled?: boolean;
}

/** Ошибка валидации или null. until — значение datetime-local. */
export function validateMaintenance(message: string, until: string): string | null {
  if (message.length > MESSAGE_LIMIT) return `Сообщение длиннее ${MESSAGE_LIMIT} символов.`;
  if (until) {
    const d = new Date(until);
    if (isNaN(d.getTime())) return 'Некорректная дата восстановления.';
    if (d.getTime() <= Date.now()) return 'Дата восстановления должна быть в будущем.';
  }
  return null;
}

export function MaintenanceFields({ message, until, onMessage, onUntil, disabled }: Props) {
  return (
    <>
      <label className="block space-y-1.5">
        <span className="flex justify-between text-xs font-semibold text-muted">
          <span>Сообщение для пользователей</span>
          <span className={message.length > MESSAGE_LIMIT ? 'text-bad' : ''}>
            {message.length}/{MESSAGE_LIMIT}
          </span>
        </span>
        <textarea
          className="input min-h-[88px] resize-y"
          value={message}
          disabled={disabled}
          placeholder="Например: обновляем базу данных, вернёмся в течение часа."
          onChange={(e) => onMessage(e.target.value)}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted">Предполагаемое время восстановления</span>
        <input
          className="input"
          type="datetime-local"
          value={until}
          disabled={disabled}
          onChange={(e) => onUntil(e.target.value)}
        />
      </label>
    </>
  );
}
