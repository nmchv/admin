const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** Подписи известных полей; остальные показываются под своим именем из БД. */
export const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  email: 'E-mail',
  phone: 'Телефон',
  name: 'Имя',
  full_name: 'Полное имя',
  first_name: 'Имя',
  last_name: 'Фамилия',
  display_name: 'Отображаемое имя',
  username: 'Логин',
  age: 'Возраст',
  birthday: 'Дата рождения',
  birth_date: 'Дата рождения',
  city: 'Город',
  school: 'Школа',
  grade: 'Класс',
  bio: 'О себе',
  avatar_url: 'Аватар',
  timezone: 'Часовой пояс',
  preferred_language: 'Язык',
  created_at: 'Создан',
  updated_at: 'Изменён',
};

export const labelOf = (key: string): string => FIELD_LABELS[key] ?? key;

export function isIso(v: unknown): v is string {
  return typeof v === 'string' && ISO.test(v);
}

const dt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Значение ячейки → текст. Объекты и массивы — компактный JSON без потери данных. */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (isIso(v)) return dt.format(new Date(v));
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
