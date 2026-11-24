nmchv admin — обновление

1) Supabase → SQL Editor: выполнить по порядку
     supabase/migrations/0005_users_full_data.sql   (все данные пользователя, графики)
     supabase/migrations/0006_maintenance_enforcement.sql   (обслуживание: закрытие БД)
     supabase/migrations/0007_access_roles_permissions.sql   (доступ к сервисам, роли, права)
2) Репозиторий nmchv/admin:  git apply admin.patch   (миграции уже включены в патч)
   затем push — GitHub Actions соберёт и задеплоит админку.
3) На каждом сайте: git apply site-patches/<сайт>.patch  → push
   (подключает maintenance.js первым скриптом в <head>).
4) Проверка: включить обслуживание сервиса → сайт показывает заглушку, таблицы сервиса закрыты.
   Раздел Access: выдать доступ к сервису, сменить роль, поменять права роли.

Чтобы сервисы учитывали выданный доступ, они должны вызывать
  rpc('cc_has_project_access', {p_slug:'tutor'})  и  rpc('cc_has_permission', {p_key:'tutor.create_task'}).
Права ролей меняет только owner; суперадмин защищён от изменений.
