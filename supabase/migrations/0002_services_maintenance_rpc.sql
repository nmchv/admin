-- =====================================================================
-- nmchv Control Center — миграция 0002 (этап 2)
-- Управление сервисами и техническим обслуживанием.
--
-- Все записи идут через SECURITY DEFINER функции с серверной проверкой роли
-- (cc_require_admin). Прямые INSERT/UPDATE/DELETE с клиента по-прежнему закрыты RLS.
-- Каждое действие пишется в cc_system_logs и cc_admin_activity в той же транзакции,
-- что и само изменение. Только добавление объектов, существующие данные не меняются.
-- =====================================================================

-- Возвращает id администратора или бросает forbidden. Наружу не выдаётся.
create or replace function public.cc_require_admin()
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare v_admin uuid;
begin
  select a.id into v_admin from public.cc_admin_users a where a.auth_user_id = auth.uid();
  if v_admin is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_admin;
end $$;

-- ---------- индивидуальное обслуживание ----------
-- p_exempt: null — не менять; true/false — исключить/вернуть в глобальный режим.
create or replace function public.cc_set_maintenance(
  p_service_id uuid,
  p_active     boolean,
  p_message    text        default null,
  p_until      timestamptz default null,
  p_exempt     boolean     default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin       uuid := public.cc_require_admin();
  v_name        text;
  v_prev_active boolean;
  v_msg         text := nullif(trim(p_message), '');
begin
  select s.name into v_name from public.cc_services s where s.id = p_service_id;
  if v_name is null then
    raise exception 'service not found' using errcode = 'P0002';
  end if;
  if char_length(coalesce(v_msg, '')) > 500 then
    raise exception 'message too long' using errcode = '22001';
  end if;

  select coalesce(m.is_active, false) into v_prev_active
  from public.cc_maintenance_settings m where m.service_id = p_service_id;

  insert into public.cc_maintenance_settings
    (service_id, is_global, is_active, exempt_from_global, message, scheduled_until, updated_by)
  values
    (p_service_id, false, p_active, coalesce(p_exempt, false), v_msg,
     case when p_active then p_until else null end, v_admin)
  on conflict (service_id) where service_id is not null do update set
    is_active          = excluded.is_active,
    exempt_from_global = coalesce(p_exempt, public.cc_maintenance_settings.exempt_from_global),
    message            = excluded.message,
    scheduled_until    = excluded.scheduled_until,
    updated_by         = excluded.updated_by;

  insert into public.cc_system_logs (category, service_id, message, metadata)
  values (
    'maintenance', p_service_id,
    case
      when p_active and not coalesce(v_prev_active, false) then format('Сервис «%s» переведён в режим обслуживания', v_name)
      when not p_active and coalesce(v_prev_active, false) then format('Сервис «%s» выведен из режима обслуживания', v_name)
      else format('Изменены настройки обслуживания сервиса «%s»', v_name)
    end,
    jsonb_build_object('admin_id', v_admin, 'active', p_active, 'message', v_msg,
                       'scheduled_until', p_until, 'exempt_from_global', p_exempt)
  );

  insert into public.cc_admin_activity (admin_id, action, target_service_id, details)
  values (
    v_admin,
    case
      when p_active and not coalesce(v_prev_active, false) then 'maintenance.service.enable'
      when not p_active and coalesce(v_prev_active, false) then 'maintenance.service.disable'
      else 'maintenance.service.update'
    end,
    p_service_id,
    jsonb_build_object('message', v_msg, 'scheduled_until', p_until, 'exempt_from_global', p_exempt)
  );
end $$;

-- ---------- глобальное обслуживание ----------
-- Возвращает число сервисов, которых коснётся режим (без исключённых).
create or replace function public.cc_set_global_maintenance(
  p_active  boolean,
  p_message text        default null,
  p_until   timestamptz default null
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.cc_require_admin();
  v_prev     boolean;
  v_affected integer;
  v_msg      text := nullif(trim(p_message), '');
begin
  if char_length(coalesce(v_msg, '')) > 500 then
    raise exception 'message too long' using errcode = '22001';
  end if;

  select coalesce(m.is_active, false) into v_prev
  from public.cc_maintenance_settings m where m.is_global;

  insert into public.cc_maintenance_settings
    (service_id, is_global, is_active, message, scheduled_until, updated_by)
  values
    (null, true, p_active,
     case when p_active then v_msg else null end,
     case when p_active then p_until else null end, v_admin)
  on conflict (is_global) where is_global do update set
    is_active       = excluded.is_active,
    message         = excluded.message,
    scheduled_until = excluded.scheduled_until,
    updated_by      = excluded.updated_by;

  select count(*)::integer into v_affected
  from public.cc_services s
  left join public.cc_maintenance_settings m on m.service_id = s.id
  where not coalesce(m.exempt_from_global, false);

  insert into public.cc_system_logs (category, message, metadata)
  values (
    'maintenance',
    case when p_active
      then format('Включено глобальное обслуживание (затронуто сервисов: %s)', v_affected)
      else 'Глобальное обслуживание снято' end,
    jsonb_build_object('admin_id', v_admin, 'active', p_active, 'affected', v_affected,
                       'message', v_msg, 'scheduled_until', p_until,
                       'was_active', coalesce(v_prev, false))
  );

  insert into public.cc_admin_activity (admin_id, action, details)
  values (
    v_admin,
    case when p_active then 'maintenance.global.enable' else 'maintenance.global.disable' end,
    jsonb_build_object('affected', v_affected, 'message', v_msg, 'scheduled_until', p_until)
  );

  return v_affected;
end $$;

-- ---------- реестр: создание и редактирование сервиса ----------
-- p_id = null → создать (slug обязателен, после создания не меняется — по нему работают приложения).
-- p_id задан  → обновить name/description/url/github_repository/is_enabled.
create or replace function public.cc_upsert_service(
  p_id          uuid,
  p_slug        text,
  p_name        text,
  p_description text,
  p_url         text,
  p_github      text,
  p_is_enabled  boolean default true
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_admin();
  v_id    uuid;
  v_name  text := nullif(trim(p_name), '');
begin
  if v_name is null then
    raise exception 'name required' using errcode = '23514';
  end if;

  if p_id is null then
    insert into public.cc_services (slug, name, description, url, github_repository, is_enabled)
    values (lower(trim(p_slug)), v_name, nullif(trim(p_description), ''), nullif(trim(p_url), ''),
            nullif(trim(p_github), ''), coalesce(p_is_enabled, true))
    returning id into v_id;

    insert into public.cc_maintenance_settings (service_id, is_global, is_active, updated_by)
    values (v_id, false, false, v_admin);

    insert into public.cc_system_logs (category, service_id, message, metadata)
    values ('admin', v_id, format('Зарегистрирован сервис «%s»', v_name), jsonb_build_object('admin_id', v_admin));
    insert into public.cc_admin_activity (admin_id, action, target_service_id, details)
    values (v_admin, 'service.create', v_id, jsonb_build_object('slug', lower(trim(p_slug))));
  else
    update public.cc_services s set
      name = v_name,
      description = nullif(trim(p_description), ''),
      url = nullif(trim(p_url), ''),
      github_repository = nullif(trim(p_github), ''),
      is_enabled = coalesce(p_is_enabled, s.is_enabled)
    where s.id = p_id
    returning s.id into v_id;

    if v_id is null then
      raise exception 'service not found' using errcode = 'P0002';
    end if;

    insert into public.cc_system_logs (category, service_id, message, metadata)
    values ('admin', v_id, format('Изменены настройки сервиса «%s»', v_name), jsonb_build_object('admin_id', v_admin));
    insert into public.cc_admin_activity (admin_id, action, target_service_id, details)
    values (v_admin, 'service.update', v_id, '{}'::jsonb);
  end if;

  return v_id;
end $$;

-- ---------- права ----------
revoke all on function public.cc_require_admin() from public, anon, authenticated;

revoke all on function public.cc_set_maintenance(uuid, boolean, text, timestamptz, boolean)       from public, anon;
revoke all on function public.cc_set_global_maintenance(boolean, text, timestamptz)               from public, anon;
revoke all on function public.cc_upsert_service(uuid, text, text, text, text, text, boolean)      from public, anon;

grant execute on function public.cc_set_maintenance(uuid, boolean, text, timestamptz, boolean)    to authenticated;
grant execute on function public.cc_set_global_maintenance(boolean, text, timestamptz)            to authenticated;
grant execute on function public.cc_upsert_service(uuid, text, text, text, text, text, boolean)   to authenticated;

-- Откат (вручную):
--   drop function if exists public.cc_upsert_service(uuid, text, text, text, text, text, boolean),
--     public.cc_set_global_maintenance(boolean, text, timestamptz),
--     public.cc_set_maintenance(uuid, boolean, text, timestamptz, boolean),
--     public.cc_require_admin();
