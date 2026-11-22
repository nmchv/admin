-- =====================================================================
-- nmchv Control Center — миграция 0001 (этап 1)
--
-- Принципы:
--  * Только добавление: никаких DROP/ALTER существующих объектов.
--  * Все объекты имеют префикс cc_, чтобы не пересечься с таблицами
--    приложений в общем проекте Supabase (services, users и т.п.).
--  * RLS включён на всех таблицах. Анонимный доступ закрыт полностью,
--    кроме RPC cc_get_maintenance (нужен приложениям для заглушки обслуживания).
--  * Записи в таблицы с клиента запрещены (нет write-политик) —
--    изменения пойдут через Edge Functions / RPC на этапе 2.
--
-- Откат (вручную, если потребуется): см. блок в конце файла.
-- =====================================================================

-- ---------- служебное ----------
create or replace function public.cc_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- администраторы ----------
create table if not exists public.cc_admin_users (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  role         text not null default 'admin' check (role in ('owner', 'admin')),
  created_at   timestamptz not null default now()
);

create or replace function public.cc_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.cc_admin_users where auth_user_id = auth.uid());
$$;

-- ---------- реестр сервисов ----------
create table if not exists public.cc_services (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  name              text not null,
  description       text,
  url               text check (url is null or url ~ '^https?://'),
  github_repository text,
  icon              text,
  is_enabled        boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists cc_services_updated_at on public.cc_services;
create trigger cc_services_updated_at before update on public.cc_services
  for each row execute function public.cc_set_updated_at();

create table if not exists public.cc_service_settings (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null unique references public.cc_services (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists cc_service_settings_updated_at on public.cc_service_settings;
create trigger cc_service_settings_updated_at before update on public.cc_service_settings
  for each row execute function public.cc_set_updated_at();

-- ---------- техническое обслуживание ----------
-- Одна глобальная строка (is_global = true, service_id is null)
-- и по одной строке на сервис (is_global = false).
-- exempt_from_global: сервис не уходит на обслуживание при глобальном режиме.
create table if not exists public.cc_maintenance_settings (
  id                 uuid primary key default gen_random_uuid(),
  service_id         uuid references public.cc_services (id) on delete cascade,
  is_global          boolean not null default false,
  is_active          boolean not null default false,
  exempt_from_global boolean not null default false,
  message            text,
  scheduled_until    timestamptz,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.cc_admin_users (id) on delete set null,
  constraint cc_maintenance_scope check (
    (is_global and service_id is null) or (not is_global and service_id is not null)
  )
);
create unique index if not exists cc_maintenance_one_global
  on public.cc_maintenance_settings (is_global) where is_global;
create unique index if not exists cc_maintenance_one_per_service
  on public.cc_maintenance_settings (service_id) where service_id is not null;
drop trigger if exists cc_maintenance_updated_at on public.cc_maintenance_settings;
create trigger cc_maintenance_updated_at before update on public.cc_maintenance_settings
  for each row execute function public.cc_set_updated_at();

-- ---------- глобальные настройки ----------
create table if not exists public.cc_system_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists cc_system_settings_updated_at on public.cc_system_settings;
create trigger cc_system_settings_updated_at before update on public.cc_system_settings
  for each row execute function public.cc_set_updated_at();

-- ---------- аналитика ----------
create table if not exists public.cc_analytics_events (
  id                   bigint generated always as identity primary key,
  service_id           uuid not null references public.cc_services (id) on delete cascade,
  event_type           text not null check (char_length(event_type) between 1 and 64),
  page_path            text check (page_path is null or char_length(page_path) <= 512),
  session_id           text not null check (char_length(session_id) <= 64),
  anonymous_visitor_id text not null check (char_length(anonymous_visitor_id) <= 64),
  device_type          text check (device_type is null or device_type in ('desktop', 'mobile', 'tablet', 'other')),
  browser              text check (browser is null or char_length(browser) <= 64),
  operating_system     text check (operating_system is null or char_length(operating_system) <= 64),
  referrer             text check (referrer is null or char_length(referrer) <= 512),
  country              text check (country is null or char_length(country) = 2),
  created_at           timestamptz not null default now()
);
create index if not exists cc_events_created_idx on public.cc_analytics_events (created_at desc);
create index if not exists cc_events_service_created_idx on public.cc_analytics_events (service_id, created_at desc);
create index if not exists cc_events_pageviews_idx on public.cc_analytics_events (created_at)
  where event_type = 'page_view';

-- ---------- мониторинг ----------
create table if not exists public.cc_service_health (
  id            bigint generated always as identity primary key,
  service_id    uuid not null references public.cc_services (id) on delete cascade,
  status        text not null check (status in ('operational', 'degraded', 'unavailable')),
  response_time integer check (response_time is null or response_time >= 0), -- мс
  http_status   integer,
  error_message text,
  checked_at    timestamptz not null default now()
);
create index if not exists cc_health_service_checked_idx
  on public.cc_service_health (service_id, checked_at desc);

-- ---------- журналы ----------
create table if not exists public.cc_system_logs (
  id         bigint generated always as identity primary key,
  category   text not null check (category in ('admin', 'maintenance', 'system', 'security', 'monitoring', 'analytics')),
  service_id uuid references public.cc_services (id) on delete set null,
  message    text not null,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cc_logs_created_idx on public.cc_system_logs (created_at desc);
create index if not exists cc_logs_category_idx on public.cc_system_logs (category, created_at desc);

create table if not exists public.cc_admin_activity (
  id                bigint generated always as identity primary key,
  admin_id          uuid references public.cc_admin_users (id) on delete set null,
  action            text not null,
  target_service_id uuid references public.cc_services (id) on delete set null,
  details           jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists cc_activity_created_idx on public.cc_admin_activity (created_at desc);

-- ---------- представление: последняя проверка каждого сервиса ----------
create or replace view public.cc_service_latest_health
with (security_invoker = true) as
select distinct on (service_id)
  service_id, status, response_time, http_status, checked_at
from public.cc_service_health
order by service_id, checked_at desc;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.cc_admin_users          enable row level security;
alter table public.cc_services             enable row level security;
alter table public.cc_service_settings     enable row level security;
alter table public.cc_maintenance_settings enable row level security;
alter table public.cc_system_settings      enable row level security;
alter table public.cc_analytics_events     enable row level security;
alter table public.cc_service_health       enable row level security;
alter table public.cc_system_logs          enable row level security;
alter table public.cc_admin_activity       enable row level security;

-- Администратор видит только свою запись в admin_users.
drop policy if exists cc_admin_users_self_read on public.cc_admin_users;
create policy cc_admin_users_self_read on public.cc_admin_users
  for select to authenticated using (auth_user_id = auth.uid());

-- Остальные таблицы: чтение только администраторам. Записи с клиента нет.
do $$
declare t text;
begin
  foreach t in array array[
    'cc_services', 'cc_service_settings', 'cc_maintenance_settings', 'cc_system_settings',
    'cc_analytics_events', 'cc_service_health', 'cc_system_logs', 'cc_admin_activity'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.cc_is_admin())',
      t || '_admin_read', t
    );
  end loop;
end $$;

-- Явно закрываем лишние права.
revoke all on
  public.cc_admin_users, public.cc_services, public.cc_service_settings,
  public.cc_maintenance_settings, public.cc_system_settings, public.cc_analytics_events,
  public.cc_service_health, public.cc_system_logs, public.cc_admin_activity,
  public.cc_service_latest_health
from anon;

revoke insert, update, delete, truncate on
  public.cc_admin_users, public.cc_services, public.cc_service_settings,
  public.cc_maintenance_settings, public.cc_system_settings, public.cc_analytics_events,
  public.cc_service_health, public.cc_system_logs, public.cc_admin_activity,
  public.cc_service_latest_health
from authenticated;

grant select on public.cc_service_latest_health to authenticated;

-- =====================================================================
-- RPC
-- =====================================================================

-- Сводка для Dashboard: текущий период, предыдущий такой же, активные за 24 ч.
create or replace function public.cc_dashboard_totals(p_from timestamptz, p_to timestamptz)
returns table (
  visitors bigint, sessions bigint, page_views bigint,
  prev_visitors bigint, prev_sessions bigint, prev_page_views bigint,
  active_24h bigint
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_len  interval := p_to - p_from;
  v_prev timestamptz := p_from - (p_to - p_from);
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    count(distinct e.anonymous_visitor_id) filter (where e.created_at >= p_from and e.created_at < p_to),
    count(distinct e.session_id)           filter (where e.created_at >= p_from and e.created_at < p_to),
    count(*) filter (where e.event_type = 'page_view' and e.created_at >= p_from and e.created_at < p_to),
    count(distinct e.anonymous_visitor_id) filter (where e.created_at >= v_prev and e.created_at < p_from),
    count(distinct e.session_id)           filter (where e.created_at >= v_prev and e.created_at < p_from),
    count(*) filter (where e.event_type = 'page_view' and e.created_at >= v_prev and e.created_at < p_from),
    count(distinct e.anonymous_visitor_id) filter (where e.created_at >= now() - interval '24 hours')
  from public.cc_analytics_events e
  where e.created_at >= least(v_prev, now() - interval '24 hours');
end $$;

-- Временной ряд посещаемости. p_bucket: hour | day | month.
create or replace function public.cc_visits_series(
  p_from timestamptz, p_to timestamptz, p_bucket text default 'day', p_tz text default 'UTC'
)
returns table (bucket timestamptz, visitors bigint, sessions bigint, page_views bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day', 'month') then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;

  return query
  select
    date_trunc(p_bucket, e.created_at at time zone p_tz) at time zone p_tz,
    count(distinct e.anonymous_visitor_id),
    count(distinct e.session_id),
    count(*) filter (where e.event_type = 'page_view')
  from public.cc_analytics_events e
  where e.created_at >= p_from and e.created_at < p_to
  group by 1
  order by 1;
end $$;

-- Посетители каждого сервиса за последние 24 часа.
create or replace function public.cc_service_visitors_24h()
returns table (service_id uuid, visitors bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select e.service_id, count(distinct e.anonymous_visitor_id)
  from public.cc_analytics_events e
  where e.created_at >= now() - interval '24 hours'
  group by e.service_id;
end $$;

-- Публичный (для приложений) статус обслуживания. Отдаёт только флаг, сообщение и дату.
-- Приоритет: глобальное (если сервис не исключён) → индивидуальное → работа в штатном режиме.
create or replace function public.cc_get_maintenance(p_slug text)
returns table (is_active boolean, message text, scheduled_until timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_id uuid;
  g record;
  s record;
begin
  select sv.id into v_id from public.cc_services sv where sv.slug = p_slug;
  if v_id is null then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  select * into s from public.cc_maintenance_settings m where m.service_id = v_id;
  select * into g from public.cc_maintenance_settings m where m.is_global;

  if coalesce(g.is_active, false) and not coalesce(s.exempt_from_global, false) then
    return query select true, g.message, g.scheduled_until;
  elsif coalesce(s.is_active, false) then
    return query select true, s.message, s.scheduled_until;
  else
    return query select false, null::text, null::timestamptz;
  end if;
end $$;

-- Запись входа администратора в журналы (вызывается клиентом после успешной проверки роли).
create or replace function public.cc_log_admin_login()
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_admin uuid;
begin
  select a.id into v_admin from public.cc_admin_users a where a.auth_user_id = auth.uid();
  if v_admin is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.cc_system_logs (category, message, metadata)
  values ('security', 'Выполнен вход администратора', jsonb_build_object('admin_id', v_admin));

  insert into public.cc_admin_activity (admin_id, action, details)
  values (v_admin, 'login', '{}'::jsonb);
end $$;

-- Права на функции: по умолчанию PUBLIC → закрываем и выдаём точечно.
revoke all on function public.cc_is_admin()                                   from public, anon;
revoke all on function public.cc_dashboard_totals(timestamptz, timestamptz)   from public, anon;
revoke all on function public.cc_visits_series(timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.cc_service_visitors_24h()                       from public, anon;
revoke all on function public.cc_log_admin_login()                            from public, anon;
revoke all on function public.cc_get_maintenance(text)                        from public;

grant execute on function public.cc_is_admin()                                   to authenticated;
grant execute on function public.cc_dashboard_totals(timestamptz, timestamptz)   to authenticated;
grant execute on function public.cc_visits_series(timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.cc_service_visitors_24h()                       to authenticated;
grant execute on function public.cc_log_admin_login()                            to authenticated;
grant execute on function public.cc_get_maintenance(text)                        to anon, authenticated;

-- =====================================================================
-- Начальные данные: восемь сервисов + строки обслуживания (всё выключено)
-- URL не заполнены намеренно: укажите реальные адреса в cc_services.url,
-- иначе мониторинг не сможет проверять сервис.
-- =====================================================================
insert into public.cc_services (slug, name, github_repository) values
  ('exam_trainer',    'Exam Trainer',    'nmchv/exam_trainer'),
  ('geotrainer',      'GeoTrainer',      'nmchv/geotrainer'),
  ('terra_incognita', 'Terra Incognita', 'nmchv/terra_incognita'),
  ('tutor',           'Tutor',           'nmchv/tutor'),
  ('teacher_diary',   'Teacher Diary',   'nmchv/teacher_diary'),
  ('web_wiki',        'Web Wiki',        'nmchv/web_wiki'),
  ('appointment',     'Appointment',     'nmchv/appointment'),
  ('web_test',        'Web Test',        'nmchv/web_test')
on conflict (slug) do nothing;

insert into public.cc_maintenance_settings (service_id, is_global, is_active)
select id, false, false from public.cc_services
on conflict do nothing;

insert into public.cc_maintenance_settings (service_id, is_global, is_active)
select null, true, false
where not exists (select 1 from public.cc_maintenance_settings where is_global);

-- =====================================================================
-- Первый администратор (выполнить ВРУЧНУЮ в SQL Editor после создания
-- пользователя в Authentication → Users; публичной регистрации админов нет):
--
--   insert into public.cc_admin_users (auth_user_id, role)
--   select id, 'owner' from auth.users where email = 'you@example.com';
-- =====================================================================

-- =====================================================================
-- Откат (только если нужно полностью убрать Control Center):
--   drop view if exists public.cc_service_latest_health;
--   drop function if exists public.cc_log_admin_login(), public.cc_get_maintenance(text),
--     public.cc_service_visitors_24h(), public.cc_visits_series(timestamptz, timestamptz, text, text),
--     public.cc_dashboard_totals(timestamptz, timestamptz), public.cc_is_admin(), public.cc_set_updated_at() cascade;
--   drop table if exists public.cc_admin_activity, public.cc_system_logs, public.cc_service_health,
--     public.cc_analytics_events, public.cc_system_settings, public.cc_maintenance_settings,
--     public.cc_service_settings, public.cc_services, public.cc_admin_users;
-- =====================================================================
