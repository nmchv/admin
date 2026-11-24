-- =====================================================================
-- nmchv Control Center — миграция 0007
-- Выдача доступа к сервисам, роли и права — из админки.
--
-- Работает с таблицами платформы:
--   user_project_access        — кому открыт какой сервис (уровень, срок, вкл/выкл)
--   user_roles                 — роль пользователя: teacher / student
--   permissions                — каталог прав (permission_key, service, name)
--   role_permissions           — какие права даёт роль
--   user_permission_overrides  — персональные исключения (разрешить/запретить, причина, срок)
--   super_admin_accounts       — единственный суперадминистратор
--
-- Правило итогового права пользователя (cc_user_permissions / cc_has_permission):
--   суперадминистратор → всё разрешено
--   иначе действующее персональное исключение (не истёк срок) → его значение
--   иначе право роли пользователя (role_permissions)
--   иначе запрещено
--
-- Все изменения — только через SECURITY DEFINER-функции с проверкой роли панели
-- и записью в cc_admin_activity. Права ролей (глобальные) меняет только owner.
-- Учётную запись суперадминистратора через панель менять нельзя.
-- Только добавление функций; существующие таблицы не меняются.
-- =====================================================================

-- ---------- служебное ----------
create or replace function public.cc_is_super_admin(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.super_admin_accounts s where s.user_id = p_user);
$$;

create or replace function public.cc_assert_not_super(p_user uuid)
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if public.cc_is_super_admin(p_user) then
    raise exception 'Учётную запись суперадминистратора нельзя менять из панели' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Пользователь не найден' using errcode = 'P0002';
  end if;
end $$;

-- ---------- список пользователей и карточка: добавлены роль и суперадмин ----------
-- Меняется набор колонок результата, поэтому функция пересоздаётся.
drop function if exists public.cc_users_list(text, integer, integer, text);
create function public.cc_users_list(
  p_q      text    default null,
  p_limit  integer default 50,
  p_offset integer default 0,
  p_sort   text    default 'created_desc'
)
returns table (
  user_id uuid, email text, phone text, display_name text, username text,
  created_at timestamptz, last_sign_in_at timestamptz,
  is_admin boolean, is_banned boolean, services text[], total bigint,
  role text, is_super_admin boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := nullif(trim(p_q), '');
  v_like text;
begin
  perform public.cc_require_admin();
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select u.id, u.email::text as email, u.phone::text as phone,
           p.display_name, p.username,
           u.created_at, u.last_sign_in_at,
           exists (select 1 from public.cc_admin_users a where a.auth_user_id = u.id) as is_admin,
           (u.banned_until is not null and u.banned_until > now()) as is_banned,
           coalesce((
             select array_agg(distinct pr.slug order by pr.slug)
             from public.user_project_access upa
             join public.projects pr on pr.id = upa.project_id
             where upa.user_id = u.id and upa.is_active
               and (upa.expires_at is null or upa.expires_at > now())
           ), '{}') as services,
           ur.role as role,
           exists (select 1 from public.super_admin_accounts s where s.user_id = u.id) as is_super_admin
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles ur on ur.user_id = u.id
    where v_q is null
       or u.email ilike v_like
       or u.phone ilike v_like
       or p.display_name ilike v_like
       or p.username ilike v_like
       or u.id::text = v_q
       or u.raw_user_meta_data::text ilike v_like
  )
  select b.id, b.email, b.phone, b.display_name, b.username, b.created_at, b.last_sign_in_at,
         b.is_admin, b.is_banned, b.services, count(*) over (), b.role, b.is_super_admin
  from base b
  order by
    case when p_sort = 'created_asc'   then b.created_at end asc,
    case when p_sort = 'seen_desc'     then b.last_sign_in_at end desc nulls last,
    case when p_sort = 'email_asc'     then b.email end asc,
    case when p_sort not in ('created_asc', 'seen_desc', 'email_asc') then b.created_at end desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end $$;

-- p_log = false — не писать «просмотр» в журнал (перезагрузка карточки после изменения доступа).
drop function if exists public.cc_user_overview(uuid);
create function public.cc_user_overview(p_user uuid, p_log boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_admin();
  v_auth  jsonb;
  v_out   jsonb;
begin
  select jsonb_build_object(
           'id', u.id,
           'email', u.email,
           'phone', u.phone,
           'email_confirmed_at', u.email_confirmed_at,
           'phone_confirmed_at', u.phone_confirmed_at,
           'created_at', u.created_at,
           'updated_at', u.updated_at,
           'last_sign_in_at', u.last_sign_in_at,
           'banned_until', u.banned_until,
           'is_anonymous', coalesce(u.is_anonymous, false),
           'providers', u.raw_app_meta_data -> 'providers',
           'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb)
         )
  into v_auth
  from auth.users u where u.id = p_user;

  if v_auth is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  v_out := jsonb_build_object(
    'auth', v_auth,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user),
    'is_admin', exists (select 1 from public.cc_admin_users a where a.auth_user_id = p_user),
    'is_super_admin', public.cc_is_super_admin(p_user),
    'role', (select ur.role from public.user_roles ur where ur.user_id = p_user),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', pr.id, 'slug', pr.slug, 'name', pr.name, 'access_level', upa.access_level,
               'is_active', upa.is_active, 'expires_at', upa.expires_at, 'since', upa.created_at
             ) order by pr.name)
      from public.user_project_access upa
      join public.projects pr on pr.id = upa.project_id
      where upa.user_id = p_user
    ), '[]'::jsonb)
  );

  if coalesce(p_log, true) then
    insert into public.cc_admin_activity (admin_id, action, details)
    values (v_admin, 'user.view', jsonb_build_object('user_id', p_user));
  end if;

  return v_out;
end $$;

-- ---------- сервисы и доступ ----------
create or replace function public.cc_access_projects()
returns table (
  id uuid, slug text, name text, description text, category text,
  status text, visibility text, url text, active_users bigint, total_grants bigint
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.cc_require_admin();
  return query
  select p.id, p.slug, p.name, p.description, p.category, p.status, p.visibility, p.url,
         count(*) filter (where upa.is_active and (upa.expires_at is null or upa.expires_at > now())),
         count(upa.user_id)
  from public.projects p
  left join public.user_project_access upa on upa.project_id = p.id
  group by p.id
  order by p.name;
end $$;

-- Кому выдан доступ к сервису (с поиском и постраничностью).
create or replace function public.cc_project_grants(
  p_project uuid,
  p_q       text    default null,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  user_id uuid, email text, display_name text, role text,
  access_level text, is_active boolean, expires_at timestamptz, created_at timestamptz, total bigint
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := nullif(trim(p_q), '');
  v_like text;
begin
  perform public.cc_require_admin();
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select upa.user_id, u.email::text, p.display_name, ur.role,
         upa.access_level, upa.is_active, upa.expires_at, upa.created_at,
         count(*) over ()
  from public.user_project_access upa
  join auth.users u on u.id = upa.user_id
  left join public.profiles p on p.id = upa.user_id
  left join public.user_roles ur on ur.user_id = upa.user_id
  where upa.project_id = p_project
    and (v_q is null or u.email ilike v_like or p.display_name ilike v_like or p.username ilike v_like)
  order by upa.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end $$;

-- Выдать или изменить доступ (повторный вызов обновляет уровень, срок и включённость).
create or replace function public.cc_grant_project_access(
  p_user    uuid,
  p_project uuid,
  p_level   text        default 'member',
  p_expires timestamptz default null,
  p_active  boolean     default true
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin   uuid := public.cc_require_admin();
  v_slug    text;
  v_level   text := coalesce(nullif(trim(p_level), ''), 'member');
  v_existed boolean;
begin
  perform public.cc_assert_not_super(p_user);
  select pr.slug into v_slug from public.projects pr where pr.id = p_project;
  if v_slug is null then
    raise exception 'Сервис не найден' using errcode = 'P0002';
  end if;
  if char_length(v_level) > 40 then
    raise exception 'Уровень доступа длиннее 40 символов' using errcode = '22001';
  end if;
  if p_expires is not null and p_expires <= now() then
    raise exception 'Срок действия должен быть в будущем' using errcode = '22023';
  end if;

  select true into v_existed from public.user_project_access
  where user_id = p_user and project_id = p_project;

  insert into public.user_project_access (user_id, project_id, access_level, is_active, expires_at)
  values (p_user, p_project, v_level, coalesce(p_active, true), p_expires)
  on conflict (user_id, project_id) do update set
    access_level = excluded.access_level,
    is_active    = excluded.is_active,
    expires_at   = excluded.expires_at;

  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin,
          case when coalesce(v_existed, false) then 'access.update' else 'access.grant' end,
          jsonb_build_object('user_id', p_user, 'project_id', p_project, 'project', v_slug,
                             'access_level', v_level, 'is_active', coalesce(p_active, true), 'expires_at', p_expires));
end $$;

create or replace function public.cc_revoke_project_access(p_user uuid, p_project uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_admin();
  v_slug  text;
  v_n     integer;
begin
  perform public.cc_assert_not_super(p_user);
  select pr.slug into v_slug from public.projects pr where pr.id = p_project;

  delete from public.user_project_access where user_id = p_user and project_id = p_project;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.cc_admin_activity (admin_id, action, details)
    values (v_admin, 'access.revoke', jsonb_build_object('user_id', p_user, 'project_id', p_project, 'project', v_slug));
  end if;
  return v_n > 0;
end $$;

-- ---------- роль пользователя ----------
-- p_role = null или '' — убрать роль.
create or replace function public.cc_set_user_role(p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_admin();
  v_role  text := nullif(trim(p_role), '');
  v_prev  text;
begin
  perform public.cc_assert_not_super(p_user);
  if v_role is not null and v_role not in ('teacher', 'student') then
    raise exception 'Роль должна быть teacher или student' using errcode = '22023';
  end if;

  select ur.role into v_prev from public.user_roles ur where ur.user_id = p_user;

  if v_role is null then
    delete from public.user_roles where user_id = p_user;
  else
    insert into public.user_roles (user_id, role) values (p_user, v_role)
    on conflict (user_id) do update set role = excluded.role, updated_at = now();
  end if;

  if v_prev is distinct from v_role then
    insert into public.cc_admin_activity (admin_id, action, details)
    values (v_admin, 'user.role.set', jsonb_build_object('user_id', p_user, 'from', v_prev, 'to', v_role));
  end if;
end $$;

-- ---------- права ----------
-- Каталог прав и что разрешено каждой роли.
create or replace function public.cc_permissions_catalog()
returns table (
  id uuid, permission_key text, service text, name text, description text,
  teacher boolean, student boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.cc_require_admin();
  return query
  select p.id, p.permission_key, p.service, p.name, p.description,
         coalesce((select bool_or(rp.is_allowed) from public.role_permissions rp where rp.permission_id = p.id and rp.role = 'teacher'), false),
         coalesce((select bool_or(rp.is_allowed) from public.role_permissions rp where rp.permission_id = p.id and rp.role = 'student'), false)
  from public.permissions p
  order by p.service, p.permission_key;
end $$;

-- Разрешить / запретить право роли. Глобальное действие — только owner.
create or replace function public.cc_set_role_permission(p_role text, p_permission uuid, p_allowed boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_owner();
  v_key   text;
  v_n     integer;
begin
  if p_role not in ('teacher', 'student') then
    raise exception 'Роль должна быть teacher или student' using errcode = '22023';
  end if;
  select pm.permission_key into v_key from public.permissions pm where pm.id = p_permission;
  if v_key is null then
    raise exception 'Право не найдено' using errcode = 'P0002';
  end if;

  update public.role_permissions set is_allowed = p_allowed
  where role = p_role and permission_id = p_permission and is_allowed is distinct from p_allowed;
  get diagnostics v_n = row_count;

  if v_n = 0 and p_allowed
     and not exists (select 1 from public.role_permissions where role = p_role and permission_id = p_permission) then
    insert into public.role_permissions (role, permission_id, is_allowed) values (p_role, p_permission, true);
    v_n := 1;
  end if;

  if v_n > 0 then
    insert into public.cc_admin_activity (admin_id, action, details)
    values (v_admin, 'access.role_permission',
            jsonb_build_object('role', p_role, 'permission', v_key, 'allowed', p_allowed));
  end if;
end $$;

-- Итоговые права пользователя с объяснением, откуда взялся результат.
create or replace function public.cc_user_permissions(p_user uuid)
returns table (
  permission_id uuid, permission_key text, service text, name text, description text,
  role_allowed boolean,
  override_allowed boolean, override_reason text, override_expires_at timestamptz,
  effective boolean, source text
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_super boolean := public.cc_is_super_admin(p_user);
  v_role  text    := (select ur.role from public.user_roles ur where ur.user_id = p_user);
begin
  perform public.cc_require_admin();
  return query
  select x.id, x.permission_key, x.service, x.name, x.description,
         x.role_allowed, x.ov_allowed, x.ov_reason, x.ov_expires,
         case when v_super then true
              when x.ov_found then x.ov_allowed
              else coalesce(x.role_allowed, false) end,
         case when v_super then 'super_admin'
              when x.ov_found then 'override'
              when x.role_allowed is not null then 'role'
              else 'default' end
  from (
    select p.id, p.permission_key, p.service, p.name, p.description,
           (select bool_or(rp.is_allowed) from public.role_permissions rp
             where v_role is not null and rp.role = v_role and rp.permission_id = p.id) as role_allowed,
           o.id is not null as ov_found,
           o.is_allowed as ov_allowed, o.reason as ov_reason, o.expires_at as ov_expires
    from public.permissions p
    left join lateral (
      select o2.* from public.user_permission_overrides o2
      where o2.user_id = p_user and o2.permission_id = p.id
        and (o2.expires_at is null or o2.expires_at > now())
      order by o2.updated_at desc limit 1
    ) o on true
  ) x
  order by x.service, x.permission_key;
end $$;

-- Персональное исключение. p_allowed = null — убрать исключение (вернуть право роли).
create or replace function public.cc_set_user_permission_override(
  p_user       uuid,
  p_permission uuid,
  p_allowed    boolean,
  p_reason     text        default null,
  p_expires    timestamptz default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin  uuid := public.cc_require_admin();
  v_key    text;
  v_reason text := nullif(trim(p_reason), '');
  v_n      integer;
begin
  perform public.cc_assert_not_super(p_user);
  select pm.permission_key into v_key from public.permissions pm where pm.id = p_permission;
  if v_key is null then
    raise exception 'Право не найдено' using errcode = 'P0002';
  end if;
  if char_length(coalesce(v_reason, '')) > 300 then
    raise exception 'Причина длиннее 300 символов' using errcode = '22001';
  end if;

  if p_allowed is null then
    delete from public.user_permission_overrides where user_id = p_user and permission_id = p_permission;
    insert into public.cc_admin_activity (admin_id, action, details)
    values (v_admin, 'access.override.remove', jsonb_build_object('user_id', p_user, 'permission', v_key));
    return;
  end if;

  if p_expires is not null and p_expires <= now() then
    raise exception 'Срок действия должен быть в будущем' using errcode = '22023';
  end if;

  update public.user_permission_overrides
  set is_allowed = p_allowed, reason = v_reason, expires_at = p_expires, updated_at = now()
  where user_id = p_user and permission_id = p_permission;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    insert into public.user_permission_overrides (user_id, permission_id, is_allowed, reason, expires_at)
    values (p_user, p_permission, p_allowed, v_reason, p_expires);
  end if;

  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'access.override.set',
          jsonb_build_object('user_id', p_user, 'permission', v_key, 'allowed', p_allowed,
                             'reason', v_reason, 'expires_at', p_expires));
end $$;

-- ---------- для самих сервисов (текущий пользователь, auth.uid()) ----------
-- Единые проверки «есть ли у меня доступ / право» с теми же правилами, что в панели.
-- Можно вызывать из RLS-политик и кода сайтов: select public.cc_has_permission('tutor.create_task').
create or replace function public.cc_has_permission(p_key text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.cc_is_super_admin(auth.uid()) then exists (select 1 from public.permissions p where p.permission_key = p_key)
    else coalesce(
      (select o.is_allowed
         from public.user_permission_overrides o
         join public.permissions p on p.id = o.permission_id
        where o.user_id = auth.uid() and p.permission_key = p_key
          and (o.expires_at is null or o.expires_at > now())
        order by o.updated_at desc limit 1),
      (select bool_or(rp.is_allowed)
         from public.role_permissions rp
         join public.permissions p on p.id = rp.permission_id
         join public.user_roles ur on ur.role = rp.role
        where ur.user_id = auth.uid() and p.permission_key = p_key),
      false)
  end;
$$;

create or replace function public.cc_has_project_access(p_slug text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.cc_is_super_admin(auth.uid())
    or exists (
      select 1 from public.user_project_access upa
      join public.projects pr on pr.id = upa.project_id
      where upa.user_id = auth.uid() and pr.slug = p_slug
        and upa.is_active and (upa.expires_at is null or upa.expires_at > now())
    )
  );
$$;

-- ---------- права на выполнение ----------
revoke all on function public.cc_is_super_admin(uuid)    from public, anon, authenticated;
revoke all on function public.cc_assert_not_super(uuid)  from public, anon, authenticated;

revoke all on function public.cc_users_list(text, integer, integer, text) from public, anon;
grant execute on function public.cc_users_list(text, integer, integer, text) to authenticated;
revoke all on function public.cc_user_overview(uuid, boolean) from public, anon;
grant execute on function public.cc_user_overview(uuid, boolean) to authenticated;

revoke all on function public.cc_access_projects()                                          from public, anon;
revoke all on function public.cc_project_grants(uuid, text, integer, integer)               from public, anon;
revoke all on function public.cc_grant_project_access(uuid, uuid, text, timestamptz, boolean) from public, anon;
revoke all on function public.cc_revoke_project_access(uuid, uuid)                          from public, anon;
revoke all on function public.cc_set_user_role(uuid, text)                                  from public, anon;
revoke all on function public.cc_permissions_catalog()                                      from public, anon;
revoke all on function public.cc_set_role_permission(text, uuid, boolean)                   from public, anon;
revoke all on function public.cc_user_permissions(uuid)                                     from public, anon;
revoke all on function public.cc_set_user_permission_override(uuid, uuid, boolean, text, timestamptz) from public, anon;
revoke all on function public.cc_has_permission(text)                                       from public, anon;
revoke all on function public.cc_has_project_access(text)                                   from public, anon;

grant execute on function public.cc_access_projects()                                          to authenticated;
grant execute on function public.cc_project_grants(uuid, text, integer, integer)               to authenticated;
grant execute on function public.cc_grant_project_access(uuid, uuid, text, timestamptz, boolean) to authenticated;
grant execute on function public.cc_revoke_project_access(uuid, uuid)                          to authenticated;
grant execute on function public.cc_set_user_role(uuid, text)                                  to authenticated;
grant execute on function public.cc_permissions_catalog()                                      to authenticated;
grant execute on function public.cc_set_role_permission(text, uuid, boolean)                   to authenticated;
grant execute on function public.cc_user_permissions(uuid)                                     to authenticated;
grant execute on function public.cc_set_user_permission_override(uuid, uuid, boolean, text, timestamptz) to authenticated;
grant execute on function public.cc_has_permission(text)                                       to authenticated;
grant execute on function public.cc_has_project_access(text)                                   to authenticated;

-- Откат (вручную):
--   drop function if exists public.cc_has_project_access(text), public.cc_has_permission(text),
--     public.cc_set_user_permission_override(uuid, uuid, boolean, text, timestamptz),
--     public.cc_user_permissions(uuid), public.cc_set_role_permission(text, uuid, boolean),
--     public.cc_permissions_catalog(), public.cc_set_user_role(uuid, text),
--     public.cc_revoke_project_access(uuid, uuid),
--     public.cc_grant_project_access(uuid, uuid, text, timestamptz, boolean),
--     public.cc_project_grants(uuid, text, integer, integer), public.cc_access_projects(),
--     public.cc_assert_not_super(uuid), public.cc_is_super_admin(uuid);
--   (cc_users_list и cc_user_overview вернуть из 0005)
