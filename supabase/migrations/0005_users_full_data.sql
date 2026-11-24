-- =====================================================================
-- nmchv Control Center — миграция 0005
-- Полные данные пользователей для администраторов.
--
--  * Только добавление функций. Таблицы не создаются и не меняются.
--  * Все функции — SECURITY DEFINER с проверкой cc_require_admin().
--  * «Все данные пользователя» собираются автоматически: функция сама находит
--    все таблицы схемы public, связанные с auth.users (напрямую или через
--    цепочку внешних ключей до 3 уровней). Новые таблицы и колонки,
--    которые вы добавите позже, появятся в карточке без изменений кода.
--  * Колонки с секретами (имя содержит hash / password / secret / token)
--    не отдаются никогда: это не данные пользователя, а защитные значения.
--  * Каждый просмотр карточки пишется в cc_admin_activity (кто и чьи данные открыл).
-- =====================================================================

-- ---------- служебное: какие таблицы относятся к пользователю ----------
-- Таблицы с префиксом cc_ (служебные таблицы панели) исключены, кроме cc_service_users.
create or replace function public.cc_user_scope()
returns table (tbl text, depth integer, parent_tbl text, fk_col text, parent_col text, user_cols text[])
language sql stable security definer
set search_path = public
as $$
  with recursive fks as (
    select c.conrelid, c.confrelid, (a.attname::text collate "default") as col, (af.attname::text collate "default") as pcol
    from pg_constraint c
    join pg_attribute a  on a.attrelid  = c.conrelid  and a.attnum  = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and c.connamespace = 'public'::regnamespace
  ),
  direct as (
    select f.conrelid as rel, array_agg(f.col order by f.col) as ucols
    from fks f
    where f.confrelid = 'auth.users'::regclass
    group by f.conrelid
  ),
  walk(rel, depth, parent, fk_col, parent_col, ucols, path) as (
    select d.rel, 0, null::oid, null::text, null::text, d.ucols, array[d.rel]
    from direct d
    union all
    select f.conrelid, w.depth + 1, f.confrelid, f.col, f.pcol, null::text[], w.path || f.conrelid
    from walk w
    join fks f on f.confrelid = w.rel
    where w.depth < 3 and not (f.conrelid = any (w.path))
  ),
  best as (
    select distinct on (w.rel) w.*
    from walk w
    order by w.rel, w.depth
  )
  select b.rel::regclass::text,
         b.depth,
         case when b.parent is null then null else b.parent::regclass::text end,
         b.fk_col,
         b.parent_col,
         b.ucols
  from best b
  where (b.rel::regclass::text !~ '^cc_' or b.rel::regclass::text = 'cc_service_users')
  order by b.depth, b.rel::regclass::text;
$$;

-- SQL-условие «строка принадлежит пользователю $1» для таблицы (рекурсивно по цепочке FK).
create or replace function public.cc_scope_where(p_map jsonb, p_tbl text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare r jsonb := p_map -> p_tbl;
begin
  if r is null then
    raise exception 'unknown table' using errcode = '22023';
  end if;
  if (r ->> 'depth')::integer = 0 then
    return '(' || (
      select string_agg(format('%I = $1', c), ' or ')
      from jsonb_array_elements_text(r -> 'user_cols') c
    ) || ')';
  end if;
  return format(
    '%I in (select %I from public.%I where %s)',
    r ->> 'fk_col', r ->> 'parent_col', r ->> 'parent_tbl',
    public.cc_scope_where(p_map, r ->> 'parent_tbl')
  );
end $$;

-- Колонки, которые нельзя отдавать (секреты).
create or replace function public.cc_hidden_cols(p_tbl text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(c.column_name::text), '{}')
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_tbl
    and c.column_name ~* '(hash|password|passwd|secret|token)';
$$;

create or replace function public.cc_scope_map()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(s.tbl, to_jsonb(s)), '{}'::jsonb) from public.cc_user_scope() s;
$$;

-- ---------- список пользователей ----------
create or replace function public.cc_users_list(
  p_q      text    default null,
  p_limit  integer default 50,
  p_offset integer default 0,
  p_sort   text    default 'created_desc'
)
returns table (
  user_id uuid, email text, phone text, display_name text, username text,
  created_at timestamptz, last_sign_in_at timestamptz,
  is_admin boolean, is_banned boolean, services text[], total bigint
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
           ), '{}') as services
    from auth.users u
    left join public.profiles p on p.id = u.id
    where v_q is null
       or u.email ilike v_like
       or u.phone ilike v_like
       or p.display_name ilike v_like
       or p.username ilike v_like
       or u.id::text = v_q
       or u.raw_user_meta_data::text ilike v_like
  )
  select b.id, b.email, b.phone, b.display_name, b.username, b.created_at, b.last_sign_in_at,
         b.is_admin, b.is_banned, b.services, count(*) over ()
  from base b
  order by
    case when p_sort = 'created_asc'   then b.created_at end asc,
    case when p_sort = 'seen_desc'     then b.last_sign_in_at end desc nulls last,
    case when p_sort = 'email_asc'     then b.email end asc,
    case when p_sort not in ('created_asc', 'seen_desc', 'email_asc') then b.created_at end desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end $$;

-- ---------- карточка пользователя: основное ----------
-- Возвращает jsonb: {auth, profile, projects, is_admin}. Пишет просмотр в журнал.
create or replace function public.cc_user_overview(p_user uuid)
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
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', pr.slug, 'name', pr.name, 'access_level', upa.access_level,
               'is_active', upa.is_active, 'expires_at', upa.expires_at, 'since', upa.created_at
             ) order by pr.name)
      from public.user_project_access upa
      join public.projects pr on pr.id = upa.project_id
      where upa.user_id = p_user
    ), '[]'::jsonb)
  );

  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'user.view', jsonb_build_object('user_id', p_user));

  return v_out;
end $$;

-- ---------- карточка пользователя: данные для графиков ----------
create or replace function public.cc_user_charts(p_user uuid, p_days integer default 90, p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 90), 730));
  v_from timestamptz := now() - make_interval(days => v_days);
  v_tz   text := coalesce(p_tz, 'UTC');
begin
  perform public.cc_require_admin();

  return jsonb_build_object(
    -- активность по дням из всех источников
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'n', d.n) order by d.day)
      from (
        select (e.ts at time zone v_tz)::date as day, count(*) as n
        from (
          select created_at as ts from public.user_activity where user_id = p_user
          union all select started_at from public.attempts where user_id = p_user
          union all select created_at from public.tutor_activity_logs where student_id = p_user
          union all select started_at from public.forms_submissions where respondent_id = p_user
          union all select to_timestamp(a.ts / 1000.0)
                    from public.geotrainer_gt_attempts a
                    join public.geotrainer_gt_users g on g.login_key = a.login_key
                    where g.linked_user_id = p_user and a.ts > 0
        ) e
        where e.ts >= v_from
        group by 1
      ) d
    ), '[]'::jsonb),

    -- попытки экзаменов: динамика результата
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', a.started_at, 'exam_id', a.exam_id, 'mode', a.mode, 'status', a.status,
               'score', a.score, 'max_score', a.max_score, 'percentage', a.percentage
             ) order by a.started_at)
      from public.attempts a
      where a.user_id = p_user and a.started_at >= v_from
    ), '[]'::jsonb),

    -- события по сервисам
    'by_project', coalesce((
      select jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'n', x.n) order by x.n desc)
      from (
        select pr.slug, pr.name, count(*) as n
        from public.user_activity ua
        join public.projects pr on pr.id = ua.project_id
        where ua.user_id = p_user and ua.created_at >= v_from
        group by pr.slug, pr.name
      ) x
    ), '[]'::jsonb),

    -- события по типам
    'by_event', coalesce((
      select jsonb_agg(jsonb_build_object('event_type', x.event_type, 'n', x.n) order by x.n desc)
      from (
        select ua.event_type, count(*) as n
        from public.user_activity ua
        where ua.user_id = p_user and ua.created_at >= v_from
        group by ua.event_type
        order by 2 desc limit 12
      ) x
    ), '[]'::jsonb),

    -- прогресс по заданиям (exam_trainer)
    'progress', coalesce((
      select jsonb_agg(jsonb_build_object(
               'exam_id', x.exam_id, 'tasks', x.tasks, 'attempts', x.attempts, 'correct', x.correct
             ) order by x.exam_id)
      from (
        select tp.exam_id, count(*) as tasks, sum(tp.attempts_count) as attempts, sum(tp.correct_count) as correct
        from public.task_progress tp
        where tp.user_id = p_user
        group by tp.exam_id
      ) x
    ), '[]'::jsonb),

    -- сводные числа
    'totals', jsonb_build_object(
      'attempts',       (select count(*) from public.attempts where user_id = p_user),
      'attempts_done',  (select count(*) from public.attempts where user_id = p_user and status = 'completed'),
      'avg_percentage', (select round(avg(percentage), 1) from public.attempts where user_id = p_user and status = 'completed' and percentage is not null),
      'best_percentage',(select max(percentage) from public.attempts where user_id = p_user and status = 'completed'),
      'events',         (select count(*) from public.user_activity where user_id = p_user),
      'achievements',   (select count(*) from public.user_achievements where user_id = p_user),
      'goals',          (select count(*) from public.user_goals where user_id = p_user),
      'notifications_unread', (select count(*) from public.notifications where user_id = p_user and not is_read),
      'last_activity',  (select max(ts) from (
                           select max(created_at) as ts from public.user_activity where user_id = p_user
                           union all select max(started_at) from public.attempts where user_id = p_user
                           union all select max(created_at) from public.tutor_activity_logs where student_id = p_user
                         ) t)
    )
  );
end $$;

-- ---------- карточка пользователя: все таблицы с данными ----------
create or replace function public.cc_user_tables(p_user uuid)
returns table (tbl text, depth integer, via text, row_count bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_map jsonb := public.cc_scope_map();
  r     record;
  v_n   bigint;
begin
  perform public.cc_require_admin();

  for r in select * from public.cc_user_scope() loop
    execute format('select count(*) from public.%I where %s', r.tbl, public.cc_scope_where(v_map, r.tbl))
      into v_n using p_user;
    tbl := r.tbl;
    depth := r.depth;
    via := case when r.depth = 0 then 'user' else r.parent_tbl end;
    row_count := v_n;
    return next;
  end loop;
end $$;

-- Строки одной таблицы, принадлежащие пользователю (постранично, секретные колонки убраны).
create or replace function public.cc_user_table_rows(
  p_user   uuid,
  p_table  text,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_map    jsonb := public.cc_scope_map();
  v_where  text;
  v_hidden text[];
  v_order  text;
  v_total  bigint;
  v_rows   jsonb;
  v_lim    integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off    integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.cc_require_admin();

  -- имя таблицы принимается только из найденного списка (защита от инъекций)
  if not (v_map ? p_table) then
    raise exception 'unknown table' using errcode = '22023';
  end if;
  v_where  := public.cc_scope_where(v_map, p_table);
  v_hidden := public.cc_hidden_cols(p_table);

  select format('%I desc', c.column_name) into v_order
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table
    and c.column_name in ('created_at', 'started_at', 'recorded_at', 'updated_at', 'joined_at', 'unlocked_at', 'last_seen', 'at', 'ts')
  order by array_position(array['created_at','started_at','recorded_at','updated_at','joined_at','unlocked_at','last_seen','at','ts'], c.column_name::text)
  limit 1;

  execute format('select count(*) from public.%I where %s', p_table, v_where) into v_total using p_user;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - $2), ''[]''::jsonb) from (select * from public.%I where %s order by %s limit %s offset %s) t',
    p_table, v_where, coalesce(v_order, 'ctid'), v_lim, v_off
  ) into v_rows using p_user, v_hidden;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'hidden_columns', to_jsonb(v_hidden));
end $$;

-- ---------- права ----------
revoke all on function public.cc_user_scope()                              from public, anon, authenticated;
revoke all on function public.cc_scope_where(jsonb, text)                  from public, anon, authenticated;
revoke all on function public.cc_hidden_cols(text)                         from public, anon, authenticated;
revoke all on function public.cc_scope_map()                               from public, anon, authenticated;
revoke all on function public.cc_users_list(text, integer, integer, text)  from public, anon;
revoke all on function public.cc_user_overview(uuid)                       from public, anon;
revoke all on function public.cc_user_charts(uuid, integer, text)          from public, anon;
revoke all on function public.cc_user_tables(uuid)                         from public, anon;
revoke all on function public.cc_user_table_rows(uuid, text, integer, integer) from public, anon;

grant execute on function public.cc_users_list(text, integer, integer, text)  to authenticated;
grant execute on function public.cc_user_overview(uuid)                       to authenticated;
grant execute on function public.cc_user_charts(uuid, integer, text)          to authenticated;
grant execute on function public.cc_user_tables(uuid)                         to authenticated;
grant execute on function public.cc_user_table_rows(uuid, text, integer, integer) to authenticated;

-- Откат (вручную):
--   drop function if exists public.cc_user_table_rows(uuid, text, integer, integer),
--     public.cc_user_tables(uuid), public.cc_user_charts(uuid, integer, text),
--     public.cc_user_overview(uuid), public.cc_users_list(text, integer, integer, text),
--     public.cc_scope_map(), public.cc_hidden_cols(text), public.cc_scope_where(jsonb, text),
--     public.cc_user_scope();
