nmchv admin — обновление

1) Supabase → SQL Editor: выполнить по порядку
     supabase/migrations/0005_users_full_data.sql
     supabase/migrations/0006_maintenance_enforcement.sql
2) Репозиторий nmchv/admin:  git apply admin.patch   (миграции уже включены в патч)
   затем push — GitHub Actions соберёт и задеплоит админку.
3) На каждом сайте: git apply site-patches/<сайт>.patch  → push
   (подключает maintenance.js первым скриптом в <head>).
4) Проверка: включить обслуживание сервиса → сайт показывает заглушку, таблицы сервиса закрыты.
