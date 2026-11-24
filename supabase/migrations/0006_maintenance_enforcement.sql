-- =====================================================================
-- nmchv Control Center — миграция 0006
-- Режим обслуживания, который действительно закрывает сервис.
--
-- Раньше кнопка только меняла флаг, а скрыть интерфейс мог лишь клиентский
-- скрипт maintenance.js (и только там, где он подключён). Теперь:
--
--  1. БД закрывается на сервере: на таблицы сервисов ставится RESTRICTIVE-политика
--     RLS. Пока сервис на обслуживании, пользователи (anon/authenticated) не могут
--     читать и писать его таблицы, даже если обойдут страницу-заглушку.
--     Администраторы панели продолжают работать.
--  2. Статус «обслуживание» синхронизируется в таблицу projects
--     (карточки на портале показывают «обслуживание»).
--  3. Панель узнаёт, подключена ли заглушка на сайте (cc_guard_ping / cc_guard_status).
--
-- Только добавление. Данные сервисов не меняются; политики можно снять
-- (см. откат в конце файла).
-- =====================================================================

-- ---------- 1. состояние обслуживания сервиса ----------
create or replace function public.cc_service_in_maintenance(p_slug text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select m.is_active from public.cc_get_maintenance(p_slug) m limit 1), false);
$$;

-- «Доступ разрешён»: сервис не на обслуживании ИЛИ запрос от администратора панели.
-- Отдельная функция с правом для anon: в политике нельзя вызывать cc_is_admin() от имени anon.
create or replace function public.cc_maintenance_gate(p_slug text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not public.cc_service_in_maintenance(p_slug)
      or exists (select 1 from public.cc_admin_users a where a.auth_user_id = auth.uid());
$$;

revoke all on function public.cc_service_in_maintenance(text) from public;
revoke all on function public.cc_maintenance_gate(text)       from public;
grant execute on function public.cc_service_in_maintenance(text) to anon, authenticated;
grant execute on function public.cc_maintenance_gate(text)       to anon, authenticated;

-- ---------- 2. серверная блокировка таблиц ----------
-- Какие таблицы принадлежат какому сервису (slug из cc_services):
--   exam_trainer — attempts, attempt_tasks, attempt_answers, task_progress, task_answer_keys, exam_scoring_rules
--   tutor        — tutor_*
--   geotrainer   — geotrainer_*
--   forms        — forms_*   (сработает, когда в панели появится сервис со slug «forms»)
-- Общие таблицы аккаунта (profiles, user_settings, projects, notifications, …) НЕ блокируются:
-- ими пользуются все сервисы сразу, а вход в аккаунт должен работать всегда.
-- Политика ставится только на таблицы, где RLS уже включён (иначе её включение
-- само по себе закрыло бы таблицу для всех).
do $$
declare
  r      record;
  v_slug text;
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and (
        c.relname in ('attempts', 'attempt_tasks', 'attempt_answers', 'task_progress', 'task_answer_keys', 'exam_scoring_rules')
        or c.relname like 'tutor\_%' or c.relname like 'geotrainer\_%' or c.relname like 'forms\_%'
      )
  loop
    v_slug := case
      when r.relname like 'tutor\_%'      then 'tutor'
      when r.relname like 'geotrainer\_%' then 'geotrainer'
      when r.relname like 'forms\_%'      then 'forms'
      else 'exam_trainer'
    end;

    if not r.relrowsecurity then
      raise notice 'RLS выключен на public.% — блокировка при обслуживании НЕ применена (включите RLS и заново выполните этот файл)', r.relname;
      continue;
    end if;

    execute format('drop policy if exists cc_maintenance_block on public.%I', r.relname);
    execute format(
      'create policy cc_maintenance_block on public.%I as restrictive for all to anon, authenticated '
      'using ((select public.cc_maintenance_gate(%L))) with check ((select public.cc_maintenance_gate(%L)))',
      r.relname, v_slug, v_slug
    );
  end loop;
end $$;

-- ---------- 3. синхронизация со статусом в projects ----------
-- Проекты, переведённые автоматически, запоминаются вместе с прежним статусом,
-- чтобы при снятии обслуживания вернуть именно его. Статусы, выставленные вручную, не трогаем.
create or replace function public.cc_sync_projects_status()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_managed jsonb;
  r         record;
begin
  if to_regclass('public.projects') is null then
    return null;
  end if;

  select coalesce(s.value, '{}'::jsonb) into v_managed
  from public.cc_system_settings s where s.key = 'maintenance.projects_synced';
  v_managed := coalesce(v_managed, '{}'::jsonb);
  if jsonb_typeof(v_managed) <> 'object' then
    v_managed := '{}'::jsonb;
  end if;

  -- включить: сервис на обслуживании, проект ещё нет
  for r in
    select p.id, p.status
    from public.projects p
    join public.cc_services s on replace(lower(s.slug), '-', '_') = replace(lower(p.slug), '-', '_')
    where p.status <> 'maintenance' and public.cc_service_in_maintenance(s.slug)
  loop
    update public.projects set status = 'maintenance' where id = r.id;
    v_managed := v_managed || jsonb_build_object(r.id::text, r.status);
  end loop;

  -- вернуть: проект переводили мы, а обслуживание уже снято
  for r in
    select p.id, p.status
    from public.projects p
    left join public.cc_services s on replace(lower(s.slug), '-', '_') = replace(lower(p.slug), '-', '_')
    where v_managed ? p.id::text
      and (s.id is null or not public.cc_service_in_maintenance(s.slug))
  loop
    if r.status = 'maintenance' then
      update public.projects set status = coalesce(v_managed ->> r.id::text, 'available') where id = r.id;
    end if;
    v_managed := v_managed - r.id::text;
  end loop;

  insert into public.cc_system_settings (key, value) values ('maintenance.projects_synced', v_managed)
  on conflict (key) do update set value = excluded.value;

  return null;
end $$;

revoke all on function public.cc_sync_projects_status() from public, anon, authenticated;

drop trigger if exists cc_maintenance_sync_projects on public.cc_maintenance_settings;
create trigger cc_maintenance_sync_projects
  after insert or update on public.cc_maintenance_settings
  for each statement execute function public.cc_sync_projects_status();

-- ---------- 4. подключена ли заглушка на сайте ----------
-- Скрипт maintenance.js дёргает это при загрузке страницы сайта. Запись не чаще раза в 10 минут.
create or replace function public.cc_guard_ping(p_slug text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_last timestamptz;
begin
  select s.id into v_id from public.cc_services s where s.slug = p_slug;
  if v_id is null then
    return;
  end if;

  select (ss.settings ->> 'guard_seen_at')::timestamptz into v_last
  from public.cc_service_settings ss where ss.service_id = v_id;
  if v_last is not null and v_last > now() - interval '10 minutes' then
    return;
  end if;

  insert into public.cc_service_settings (service_id, settings)
  values (v_id, jsonb_build_object('guard_seen_at', to_jsonb(now())))
  on conflict (service_id) do update
    set settings = public.cc_service_settings.settings || jsonb_build_object('guard_seen_at', to_jsonb(now()));
end $$;

create or replace function public.cc_guard_status()
returns table (service_id uuid, guard_seen_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.cc_require_admin();
  return query
  select ss.service_id, (ss.settings ->> 'guard_seen_at')::timestamptz
  from public.cc_service_settings ss
  where ss.settings ? 'guard_seen_at';
end $$;

revoke all on function public.cc_guard_ping(text)   from public;
revoke all on function public.cc_guard_status()     from public, anon;
grant execute on function public.cc_guard_ping(text) to anon, authenticated;
grant execute on function public.cc_guard_status()   to authenticated;

-- Откат (вручную):
--   drop trigger if exists cc_maintenance_sync_projects on public.cc_maintenance_settings;
--   drop function if exists public.cc_sync_projects_status(), public.cc_guard_status(),
--     public.cc_guard_ping(text), public.cc_maintenance_gate(text), public.cc_service_in_maintenance(text);
--   и для каждой таблицы: drop policy if exists cc_maintenance_block on public.<таблица>;
