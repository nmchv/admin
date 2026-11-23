-- =====================================================================
-- nmchv Control Center — миграция 0004 (этапы 4–5)
-- Мониторинг, пользователи, настройки, администраторы.
--
--  * Только добавление. Единственное изменение существующей таблицы —
--    необязательная колонка cc_service_health.error_type.
--  * Мониторинг пишет данные через RPC с секретным токеном (хранится только хэш).
--    service_role key нигде не нужен.
--  * Все чтения для панели — RPC/RLS только для администраторов.
-- =====================================================================

-- ---------- расширение существующей таблицы ----------
alter table public.cc_service_health
  add column if not exists error_type text
  check (error_type is null or error_type in ('timeout', 'dns', 'connection', 'tls', 'http_4xx', 'http_5xx', 'slow', 'other'));

-- ---------- новые таблицы ----------
create table if not exists public.cc_infra_health (
  id            bigint generated always as identity primary key,
  component     text not null check (component in ('database', 'api', 'auth')),
  status        text not null check (status in ('operational', 'degraded', 'unavailable')),
  response_time integer check (response_time is null or response_time >= 0),
  error_message text,
  checked_at    timestamptz not null default now()
);
create index if not exists cc_infra_component_checked_idx
  on public.cc_infra_health (component, checked_at desc);

create table if not exists public.cc_incidents (
  id            bigint generated always as identity primary key,
  service_id    uuid not null references public.cc_services (id) on delete cascade,
  severity      text not null check (severity in ('degraded', 'unavailable')),
  started_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  http_status   integer,
  error_type    text,
  error_message text,
  check (resolved_at is null or resolved_at >= started_at)
);
create unique index if not exists cc_incidents_one_open
  on public.cc_incidents (service_id) where resolved_at is null;
create index if not exists cc_incidents_started_idx on public.cc_incidents (started_at desc);

-- Регистрация пользователей в сервисах: один человек (auth.users.id) = одна запись на сервис.
create table if not exists public.cc_service_users (
  user_id       uuid not null references auth.users (id) on delete cascade,
  service_id    uuid not null references public.cc_services (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, service_id)
);
create index if not exists cc_service_users_service_idx on public.cc_service_users (service_id);

alter table public.cc_infra_health  enable row level security;
alter table public.cc_incidents     enable row level security;
alter table public.cc_service_users enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cc_infra_health', 'cc_incidents', 'cc_service_users'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.cc_is_admin())',
      t || '_admin_read', t
    );
  end loop;
end $$;

revoke all on public.cc_infra_health, public.cc_incidents, public.cc_service_users from anon;
revoke insert, update, delete, truncate on
  public.cc_infra_health, public.cc_incidents, public.cc_service_users from authenticated;

-- ---------- внутренние помощники (наружу не выдаются) ----------
create or replace function public.cc_require_owner()
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare v_admin uuid := public.cc_require_admin();
begin
  if (select a.role from public.cc_admin_users a where a.id = v_admin) <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_admin;
end $$;

create or replace function public.cc_setting_int(p_key text, p_default integer)
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric::integer end
     from public.cc_system_settings s where s.key = p_key),
    p_default);
$$;

create or replace function public.cc_monitor_token_ok(p_token text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_token is not null
     and char_length(p_token) >= 32
     and exists (
       select 1 from public.cc_system_settings s
       where s.key = 'monitoring.token_hash'
         and s.value = to_jsonb(encode(sha256(convert_to(p_token, 'utf8')), 'hex'))
     );
$$;

-- ---------- токен мониторинга ----------
-- Возвращает токен ОДИН раз; в БД остаётся только sha256-хэш.
create or replace function public.cc_rotate_monitor_token()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_owner();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.cc_system_settings (key, value)
  values ('monitoring.token_hash', to_jsonb(encode(sha256(convert_to(v_token, 'utf8')), 'hex')))
  on conflict (key) do update set value = excluded.value;

  insert into public.cc_system_logs (category, message, metadata)
  values ('security', 'Выпущен новый токен мониторинга', jsonb_build_object('admin_id', v_admin));
  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'monitoring.token.rotate', '{}'::jsonb);

  return v_token;
end $$;

-- ---------- настройки ----------
create or replace function public.cc_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_admin();
  v_t     text := jsonb_typeof(p_value);
  v_s     text;
  v_n     numeric;
  v_ok    boolean := false;
begin
  if p_key in ('general.system_name', 'general.ecosystem_name', 'general.main_domain',
               'general.timezone', 'general.language') then
    if v_t = 'string' then
      v_s := p_value #>> '{}';
      v_ok := case p_key
        when 'general.system_name'    then char_length(v_s) between 1 and 60
        when 'general.ecosystem_name' then char_length(v_s) between 1 and 60
        when 'general.main_domain'    then v_s ~ '^([a-z0-9-]+\.)+[a-z]{2,}$'
        when 'general.timezone'       then exists (select 1 from pg_timezone_names n where n.name = v_s)
        when 'general.language'       then v_s in ('ru')
      end;
    end if;
  elsif p_key in ('monitoring.interval_minutes', 'monitoring.slow_ms', 'monitoring.timeout_ms',
                  'monitoring.retention_days', 'analytics.retention_days') then
    if v_t = 'number' then
      v_n := (p_value #>> '{}')::numeric;
      v_ok := v_n = trunc(v_n) and case p_key
        when 'monitoring.interval_minutes' then v_n between 5 and 1440
        when 'monitoring.slow_ms'          then v_n between 200 and 30000
        when 'monitoring.timeout_ms'       then v_n between 1000 and 30000
        when 'monitoring.retention_days'   then v_n between 7 and 3650
        when 'analytics.retention_days'    then v_n between 0 and 3650
      end;
    end if;
  elsif p_key in ('analytics.enabled', 'notifications.down', 'notifications.errors',
                  'notifications.recovered', 'notifications.settings_changed') then
    v_ok := v_t = 'boolean';
  else
    raise exception 'unknown setting' using errcode = '22023';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  insert into public.cc_system_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;

  insert into public.cc_system_logs (category, message, metadata)
  values ('admin', format('Изменена настройка «%s»', p_key),
          jsonb_build_object('admin_id', v_admin, 'key', p_key, 'value', p_value));
  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'setting.update', jsonb_build_object('key', p_key, 'value', p_value));
end $$;

-- Пути, которые монитор проверяет у сервиса (по умолчанию только «/»).
create or replace function public.cc_set_health_paths(p_service_id uuid, p_paths text[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_admin();
  v_name  text;
  p       text;
begin
  select s.name into v_name from public.cc_services s where s.id = p_service_id;
  if v_name is null then
    raise exception 'service not found' using errcode = 'P0002';
  end if;
  if p_paths is null or cardinality(p_paths) not between 1 and 5 then
    raise exception 'invalid paths' using errcode = '22023';
  end if;
  foreach p in array p_paths loop
    if p is null or p !~ '^/[^[:space:]]{0,200}$' then
      raise exception 'invalid path' using errcode = '22023';
    end if;
  end loop;

  insert into public.cc_service_settings (service_id, settings)
  values (p_service_id, jsonb_build_object('health_paths', to_jsonb(p_paths)))
  on conflict (service_id) do update
    set settings = public.cc_service_settings.settings || jsonb_build_object('health_paths', to_jsonb(p_paths));

  insert into public.cc_system_logs (category, service_id, message, metadata)
  values ('admin', p_service_id, format('Изменены пути мониторинга сервиса «%s»', v_name),
          jsonb_build_object('admin_id', v_admin, 'paths', to_jsonb(p_paths)));
  insert into public.cc_admin_activity (admin_id, action, target_service_id, details)
  values (v_admin, 'service.health_paths', p_service_id, jsonb_build_object('paths', to_jsonb(p_paths)));
end $$;

-- ---------- очистка устаревших данных (не чаще раза в сутки) ----------
create or replace function public.cc_purge_old_data()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_last   timestamptz;
  v_days   integer := public.cc_setting_int('monitoring.retention_days', 90);
  v_an     integer := public.cc_setting_int('analytics.retention_days', 0);
  v_h      bigint := 0;
  v_i      bigint := 0;
  v_a      bigint := 0;
  v_cnt    bigint;
begin
  select (s.value #>> '{}')::timestamptz into v_last
  from public.cc_system_settings s where s.key = 'housekeeping.last_run';
  if v_last is not null and v_last > now() - interval '1 day' then
    return;
  end if;

  delete from public.cc_service_health where checked_at < now() - make_interval(days => v_days);
  get diagnostics v_h = row_count;
  delete from public.cc_infra_health where checked_at < now() - make_interval(days => v_days);
  get diagnostics v_i = row_count;
  if v_an > 0 then
    delete from public.cc_analytics_events where created_at < now() - make_interval(days => v_an);
    get diagnostics v_a = row_count;
  end if;

  insert into public.cc_system_settings (key, value) values ('housekeeping.last_run', to_jsonb(now()))
  on conflict (key) do update set value = excluded.value;

  v_cnt := v_h + v_i + v_a;
  if v_cnt > 0 then
    insert into public.cc_system_logs (category, message, metadata)
    values ('system', 'Выполнена очистка устаревших данных',
            jsonb_build_object('service_health', v_h, 'infra_health', v_i, 'analytics_events', v_a));
  end if;
end $$;

-- ---------- мониторинг: что проверять ----------
create or replace function public.cc_monitor_targets(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_monitor_token_ok(p_token) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'config', jsonb_build_object(
      'interval_minutes', public.cc_setting_int('monitoring.interval_minutes', 5),
      'slow_ms',          public.cc_setting_int('monitoring.slow_ms', 3000),
      'timeout_ms',       public.cc_setting_int('monitoring.timeout_ms', 10000)
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', s.slug,
        'url', s.url,
        'paths', coalesce(ss.settings -> 'health_paths', '["/"]'::jsonb),
        'last_checked_at', (select max(h.checked_at) from public.cc_service_health h where h.service_id = s.id)
      ) order by s.slug)
      from public.cc_services s
      left join public.cc_service_settings ss on ss.service_id = s.id
      where s.is_enabled and s.url is not null
    ), '[]'::jsonb)
  );
end $$;

-- ---------- мониторинг: запись результатов ----------
-- p_results: [{slug,status,response_time,http_status,error_type,error_message}]
-- p_infra:   [{component,status,response_time,error_message}]
-- Ведёт историю, инциденты (открытие/закрытие) и пишет в журнал только смены состояния.
create or replace function public.cc_record_health(p_token text, p_results jsonb, p_infra jsonb default '[]'::jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r         jsonb;
  v_svc_id  uuid;
  v_name    text;
  v_status  text;
  v_prev    text;
  v_rt      integer;
  v_http    integer;
  v_etype   text;
  v_emsg    text;
  v_started timestamptz;
  v_n       integer := 0;
begin
  if not public.cc_monitor_token_ok(p_token) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 50
     or jsonb_typeof(coalesce(p_infra, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_infra, '[]'::jsonb)) > 10 then
    raise exception 'invalid payload' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_results) loop
    continue when jsonb_typeof(r) <> 'object';
    v_status := r ->> 'status';
    continue when v_status is null or v_status not in ('operational', 'degraded', 'unavailable');

    select s.id, s.name into v_svc_id, v_name from public.cc_services s where s.slug = r ->> 'slug';
    continue when v_svc_id is null;

    v_rt   := case when (r ->> 'response_time') ~ '^[0-9]{1,9}$' then (r ->> 'response_time')::integer end;
    v_http := case when (r ->> 'http_status') ~ '^[0-9]{3}$' then (r ->> 'http_status')::integer end;
    v_emsg := left(r ->> 'error_message', 500);
    v_etype := case when v_status = 'operational' then null
                    when r ->> 'error_type' in ('timeout', 'dns', 'connection', 'tls', 'http_4xx', 'http_5xx', 'slow')
                      then r ->> 'error_type'
                    else 'other' end;

    select h.status into v_prev from public.cc_service_health h
    where h.service_id = v_svc_id order by h.checked_at desc limit 1;

    insert into public.cc_service_health (service_id, status, response_time, http_status, error_type, error_message)
    values (v_svc_id, v_status, v_rt, v_http, v_etype, v_emsg);
    v_n := v_n + 1;

    if v_status <> 'operational' then
      insert into public.cc_incidents (service_id, severity, http_status, error_type, error_message)
      values (v_svc_id, v_status, v_http, v_etype, v_emsg)
      on conflict (service_id) where resolved_at is null do update set
        severity      = case when excluded.severity = 'unavailable' or public.cc_incidents.severity = 'unavailable'
                             then 'unavailable' else 'degraded' end,
        http_status   = excluded.http_status,
        error_type    = excluded.error_type,
        error_message = excluded.error_message;
    else
      update public.cc_incidents set resolved_at = now()
      where service_id = v_svc_id and resolved_at is null
      returning started_at into v_started;
    end if;

    if v_prev is distinct from v_status and not (v_prev is null and v_status = 'operational') then
      insert into public.cc_system_logs (category, service_id, message, metadata)
      values (
        'monitoring', v_svc_id,
        case v_status
          when 'unavailable' then format('Сервис «%s» недоступен%s', v_name, coalesce(' (' || v_emsg || ')', ''))
          when 'degraded'    then format('Сервис «%s» работает с ограничениями%s', v_name, coalesce(' (' || v_emsg || ')', ''))
          else format('Сервис «%s» восстановлен', v_name)
        end,
        jsonb_build_object(
          'source', 'monitor',
          'event', case v_status when 'unavailable' then 'down' when 'degraded' then 'degraded' else 'recovered' end,
          'previous', v_prev, 'http_status', v_http, 'error_type', v_etype, 'response_time', v_rt,
          'downtime_minutes', case when v_started is not null
                                   then round(extract(epoch from (now() - v_started)) / 60) end
        )
      );
    end if;
    v_started := null;
  end loop;

  -- инфраструктура Supabase
  for r in select * from jsonb_array_elements(coalesce(p_infra, '[]'::jsonb)) loop
    continue when jsonb_typeof(r) <> 'object';
    continue when (r ->> 'component') not in ('database', 'api', 'auth');
    v_status := r ->> 'status';
    continue when v_status is null or v_status not in ('operational', 'degraded', 'unavailable');

    v_rt := case when (r ->> 'response_time') ~ '^[0-9]{1,9}$' then (r ->> 'response_time')::integer end;
    v_emsg := left(r ->> 'error_message', 500);

    select h.status into v_prev from public.cc_infra_health h
    where h.component = r ->> 'component' order by h.checked_at desc limit 1;

    insert into public.cc_infra_health (component, status, response_time, error_message)
    values (r ->> 'component', v_status, v_rt, v_emsg);

    if v_prev is distinct from v_status and not (v_prev is null and v_status = 'operational') then
      insert into public.cc_system_logs (category, message, metadata)
      values (
        'monitoring',
        case when v_status = 'operational'
          then format('Компонент Supabase «%s» восстановлен', r ->> 'component')
          else format('Компонент Supabase «%s»: %s%s', r ->> 'component',
                      case v_status when 'unavailable' then 'недоступен' else 'работает медленно' end,
                      coalesce(' (' || v_emsg || ')', '')) end,
        jsonb_build_object('source', 'monitor', 'component', r ->> 'component',
                           'event', case when v_status = 'operational' then 'infra_recovered' else 'infra_down' end)
      );
    end if;
  end loop;

  perform public.cc_purge_old_data();
  return v_n;
end $$;

-- ---------- мониторинг: отчёты ----------
-- Uptime = доля проверок со статусом, отличным от unavailable (degraded считается «доступен»).
create or replace function public.cc_monitoring_overview()
returns table (
  service_id uuid, uptime_24h numeric, uptime_7d numeric, uptime_30d numeric,
  avg_response_ms numeric, checks_24h bigint, last_check_at timestamptz,
  last_incident_at timestamptz, open_incident boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    round(100.0 * count(*) filter (where h.checked_at >= now() - interval '24 hours' and h.status <> 'unavailable')
          / nullif(count(*) filter (where h.checked_at >= now() - interval '24 hours'), 0), 2),
    round(100.0 * count(*) filter (where h.checked_at >= now() - interval '7 days' and h.status <> 'unavailable')
          / nullif(count(*) filter (where h.checked_at >= now() - interval '7 days'), 0), 2),
    round(100.0 * count(*) filter (where h.status <> 'unavailable') / nullif(count(h.id), 0), 2),
    round(avg(h.response_time) filter (where h.checked_at >= now() - interval '24 hours' and h.response_time is not null)),
    count(*) filter (where h.checked_at >= now() - interval '24 hours'),
    max(h.checked_at),
    (select max(i.started_at) from public.cc_incidents i where i.service_id = s.id),
    exists (select 1 from public.cc_incidents i where i.service_id = s.id and i.resolved_at is null)
  from public.cc_services s
  left join public.cc_service_health h on h.service_id = s.id and h.checked_at >= now() - interval '30 days'
  group by s.id
  order by s.name;
end $$;

create or replace function public.cc_infra_summary()
returns table (
  component text, status text, response_time integer, error_message text,
  checked_at timestamptz, checks_24h bigint, failures_24h bigint, avg_ms_24h numeric
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select c.component, l.status, l.response_time, l.error_message, l.checked_at,
         coalesce(st.n, 0), coalesce(st.f, 0), round(st.a)
  from (values ('database'), ('api'), ('auth')) as c(component)
  left join lateral (
    select h.status, h.response_time, h.error_message, h.checked_at
    from public.cc_infra_health h where h.component = c.component
    order by h.checked_at desc limit 1
  ) l on true
  left join lateral (
    select count(*) as n, count(*) filter (where h.status = 'unavailable') as f, avg(h.response_time) as a
    from public.cc_infra_health h
    where h.component = c.component and h.checked_at >= now() - interval '24 hours'
  ) st on true;
end $$;

-- ---------- пользователи ----------
create or replace function public.cc_users_summary()
returns table (
  registered bigint, admins bigint, new_7d bigint, new_30d bigint,
  active_7d bigint, active_30d bigint, in_services bigint
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where a.id is null),
    count(*) filter (where a.id is not null),
    count(*) filter (where a.id is null and u.created_at >= now() - interval '7 days'),
    count(*) filter (where a.id is null and u.created_at >= now() - interval '30 days'),
    count(*) filter (where a.id is null and u.last_sign_in_at >= now() - interval '7 days'),
    count(*) filter (where a.id is null and u.last_sign_in_at >= now() - interval '30 days'),
    (select count(distinct su.user_id) from public.cc_service_users su)
  from auth.users u
  left join public.cc_admin_users a on a.auth_user_id = u.id;
end $$;

create or replace function public.cc_users_by_service()
returns table (service_id uuid, users bigint, new_30d bigint, active_30d bigint)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select su.service_id,
         count(*),
         count(*) filter (where su.first_seen_at >= now() - interval '30 days'),
         count(*) filter (where su.last_seen_at >= now() - interval '30 days')
  from public.cc_service_users su
  group by su.service_id
  order by 2 desc;
end $$;

create or replace function public.cc_registrations_series(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns table (bucket timestamptz, registrations bigint)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with b as (
    select gs as ts from generate_series(
      date_trunc('day', p_from at time zone p_tz),
      date_trunc('day', least(p_to, now()) at time zone p_tz),
      interval '1 day') gs
  ),
  agg as (
    select date_trunc('day', u.created_at at time zone p_tz) as ts, count(*) as n
    from auth.users u
    where u.created_at >= p_from and u.created_at < p_to
      and not exists (select 1 from public.cc_admin_users a where a.auth_user_id = u.id)
    group by 1
  )
  select b.ts at time zone p_tz, coalesce(agg.n, 0) from b left join agg on agg.ts = b.ts order by b.ts;
end $$;

-- Приложения вызывают из-под JWT вошедшего пользователя (общий проект Supabase):
--   supabase.rpc('cc_register_service_user', { p_service: 'geotrainer' })
create or replace function public.cc_register_service_user(p_service text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;
  select s.id into v_id from public.cc_services s where s.slug = p_service and s.is_enabled;
  if v_id is null then
    return;
  end if;
  insert into public.cc_service_users (user_id, service_id) values (auth.uid(), v_id)
  on conflict (user_id, service_id) do update set last_seen_at = now();
end $$;

-- ---------- администраторы ----------
create or replace function public.cc_list_admins()
returns table (id uuid, auth_user_id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select a.id, a.auth_user_id, u.email::text, a.role, a.created_at, u.last_sign_in_at
  from public.cc_admin_users a
  join auth.users u on u.id = a.auth_user_id
  order by a.created_at;
end $$;

-- Пользователь должен уже существовать в Supabase Auth (публичной регистрации админов нет).
create or replace function public.cc_grant_admin(p_email text, p_role text default 'admin')
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := public.cc_require_owner();
  v_user  uuid;
  v_new   uuid;
begin
  if p_role not in ('owner', 'admin') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.cc_admin_users (auth_user_id, role) values (v_user, p_role) returning id into v_new;

  insert into public.cc_system_logs (category, message, metadata)
  values ('security', format('Выданы права администратора (%s): %s', p_role, lower(trim(p_email))),
          jsonb_build_object('admin_id', v_admin, 'granted_admin_id', v_new, 'role', p_role));
  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'admin.grant', jsonb_build_object('granted_admin_id', v_new, 'role', p_role));
  return v_new;
end $$;

create or replace function public.cc_revoke_admin(p_admin_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin  uuid := public.cc_require_owner();
  v_role   text;
  v_email  text;
begin
  if p_admin_id = v_admin then
    raise exception 'cannot revoke yourself' using errcode = '22023';
  end if;
  select a.role, u.email into v_role, v_email
  from public.cc_admin_users a join auth.users u on u.id = a.auth_user_id
  where a.id = p_admin_id;
  if v_role is null then
    raise exception 'admin not found' using errcode = 'P0002';
  end if;
  if v_role = 'owner' and (select count(*) from public.cc_admin_users x where x.role = 'owner') <= 1 then
    raise exception 'cannot revoke last owner' using errcode = '22023';
  end if;

  delete from public.cc_admin_users where id = p_admin_id;

  insert into public.cc_system_logs (category, message, metadata)
  values ('security', format('Отозваны права администратора: %s', lower(v_email)),
          jsonb_build_object('admin_id', v_admin, 'revoked_role', v_role));
  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'admin.revoke', jsonb_build_object('revoked_role', v_role));
end $$;

-- ---------- права ----------
revoke all on function public.cc_require_owner()                         from public, anon, authenticated;
revoke all on function public.cc_setting_int(text, integer)              from public, anon, authenticated;
revoke all on function public.cc_monitor_token_ok(text)                  from public, anon, authenticated;
revoke all on function public.cc_purge_old_data()                        from public, anon, authenticated;

revoke all on function public.cc_rotate_monitor_token()                  from public, anon;
revoke all on function public.cc_set_setting(text, jsonb)                from public, anon;
revoke all on function public.cc_set_health_paths(uuid, text[])          from public, anon;
revoke all on function public.cc_monitoring_overview()                   from public, anon;
revoke all on function public.cc_infra_summary()                         from public, anon;
revoke all on function public.cc_users_summary()                         from public, anon;
revoke all on function public.cc_users_by_service()                      from public, anon;
revoke all on function public.cc_registrations_series(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.cc_list_admins()                           from public, anon;
revoke all on function public.cc_grant_admin(text, text)                 from public, anon;
revoke all on function public.cc_revoke_admin(uuid)                      from public, anon;
revoke all on function public.cc_register_service_user(text)             from public, anon;
revoke all on function public.cc_monitor_targets(text)                   from public;
revoke all on function public.cc_record_health(text, jsonb, jsonb)       from public;

grant execute on function public.cc_rotate_monitor_token()                to authenticated;
grant execute on function public.cc_set_setting(text, jsonb)              to authenticated;
grant execute on function public.cc_set_health_paths(uuid, text[])        to authenticated;
grant execute on function public.cc_monitoring_overview()                 to authenticated;
grant execute on function public.cc_infra_summary()                       to authenticated;
grant execute on function public.cc_users_summary()                       to authenticated;
grant execute on function public.cc_users_by_service()                    to authenticated;
grant execute on function public.cc_registrations_series(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cc_list_admins()                         to authenticated;
grant execute on function public.cc_grant_admin(text, text)               to authenticated;
grant execute on function public.cc_revoke_admin(uuid)                    to authenticated;
grant execute on function public.cc_register_service_user(text)           to authenticated;
-- Монитор (GitHub Actions) вызывает с anon-ключом + секретным токеном; токен проверяется внутри.
grant execute on function public.cc_monitor_targets(text)                 to anon, authenticated;
grant execute on function public.cc_record_health(text, jsonb, jsonb)     to anon, authenticated;

-- Откат (вручную):
--   drop function if exists public.cc_revoke_admin(uuid), public.cc_grant_admin(text, text),
--     public.cc_list_admins(), public.cc_register_service_user(text),
--     public.cc_registrations_series(timestamptz, timestamptz, text), public.cc_users_by_service(),
--     public.cc_users_summary(), public.cc_infra_summary(), public.cc_monitoring_overview(),
--     public.cc_record_health(text, jsonb, jsonb), public.cc_monitor_targets(text),
--     public.cc_purge_old_data(), public.cc_set_health_paths(uuid, text[]), public.cc_set_setting(text, jsonb),
--     public.cc_rotate_monitor_token(), public.cc_monitor_token_ok(text), public.cc_setting_int(text, integer),
--     public.cc_require_owner();
--   drop table if exists public.cc_service_users, public.cc_incidents, public.cc_infra_health;
--   alter table public.cc_service_health drop column if exists error_type;
