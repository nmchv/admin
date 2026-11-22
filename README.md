# nmchv Control Center

Единая административная панель экосистемы nmchv. React + Vite + TypeScript + Tailwind, данные и авторизация — Supabase, хостинг — GitHub Pages (`admin.nmchv.ru`).

## Статус реализации

| Этап | Содержание | Статус |
|---|---|---|
| 1. Основа | Каркас, дизайн-система, Sidebar/Header, Dashboard, Supabase, авторизация, миграция | ✅ готово |
| 2. Управление сервисами | Реестр, обслуживание (индивидуальное/глобальное), страница обслуживания | ✅ готово |
| 3. Аналитика | Analytics SDK, приём событий (Edge Function), графики | ⏳ запланировано |
| 4. Мониторинг | Серверные проверки, история, uptime | ⏳ запланировано |
| 5. Дополнительно | Users, System Logs, уведомления, настройки | ⏳ запланировано |

Разделы, которых ещё нет, в интерфейсе явно помечены как «запланировано» — без имитации данных.

## Локальный запуск

```bash
npm install
cp .env.example .env   # заполнить VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm run dev
```

Проверки: `npm run typecheck`, `npm run build`.

## Подключение Supabase

1. **Сначала изучите существующую БД** (Table Editor / `\dt public.*`). Миграция только добавляет объекты с префиксом `cc_` и ничего не удаляет и не меняет, но убедитесь, что имена `cc_*` свободны.
2. Выполните по порядку `supabase/migrations/0001_control_center_init.sql` и `0002_services_maintenance_rpc.sql` в SQL Editor (или через `supabase db push`).
3. В **Authentication → Users** создайте пользователя (email + пароль). В **Authentication → Providers → Email** отключите «Allow new users to sign up» — публичной регистрации быть не должно.
4. Сделайте его администратором (SQL Editor):
   ```sql
   insert into public.cc_admin_users (auth_user_id, role)
   select id, 'owner' from auth.users where email = 'you@example.com';
   ```
5. Заполните URL и репозитории сервисов: **Services → карточка сервиса → Изменить** (в seed они намеренно пустые).

### Безопасность
- В клиенте только публичный anon key. `service_role` key в репозиторий и в сборку не попадает никогда.
- RLS включён на всех таблицах; анонимный доступ закрыт. Единственный публичный вызов — RPC `cc_get_maintenance(slug)`, отдающий только флаг/сообщение/дату обслуживания.
- Роль проверяется на сервере (`cc_is_admin()` / `cc_require_admin()`), в т. ч. внутри каждого RPC. Прямые записи в таблицы с клиента запрещены RLS; изменения идут только через SECURITY DEFINER функции (`cc_set_maintenance`, `cc_set_global_maintenance`, `cc_upsert_service`), которые заодно пишут журналы в той же транзакции.
- Проверьте RLS: из-под anon-ключа `select * from cc_services` должен вернуть 0 строк/ошибку.

## GitHub Pages

1. Репозиторий `nmchv/control-center`, ветка `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions**: добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
4. DNS: `CNAME admin → nmchv.github.io`. Файл `public/CNAME` уже содержит `admin.nmchv.ru`. После первой публикации включите **Enforce HTTPS**.
5. Роутинг — HashRouter (`/#/services`), поэтому SPA-fallback для GitHub Pages не нужен.

Workflow `.github/workflows/deploy.yml`: `npm ci` → typecheck → build → публикация. Во время сборки публичные URL и anon key подставляются в `maintenance.js`.

## Структура

```
src/components/{layout,dashboard,ui}   UI
src/pages                              экраны
src/lib/{supabase,auth}                доступ к данным и авторизация
src/utils                              статусы, форматирование
supabase/migrations                    SQL
```

## Подключение сервисов

Новый сервис регистрируется в **Services → Добавить сервис** — код панели менять не нужно. Подключение приложения к странице обслуживания: [docs/connect-service.md](docs/connect-service.md).
