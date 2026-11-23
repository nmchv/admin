-- =====================================================================
-- nmchv Control Center — миграция 0003 (этап 3)
-- Аналитика: приём событий от SDK и отчёты для панели.
--
-- Приём: публичная RPC cc_track_events (anon). Принимает только пакеты для
-- зарегистрированных сервисов, валидирует поля и типы событий, обрезает длины,
-- ограничивает частоту по посетителю. Прямой INSERT в таблицу по-прежнему закрыт RLS.
-- Отчёты: RPC только для администраторов (cc_is_admin).
--
-- Отключить сбор можно строкой в cc_system_settings:
--   insert into cc_system_settings(key, value) values ('analytics.enabled', 'false');
-- =====================================================================

create index if not exists cc_events_visitor_idx
  on public.cc_analytics_events (anonymous_visitor_id, created_at desc);

-- ---------- классификация источника трафика ----------
create or replace function public.cc_classify_referrer(p_host text)
returns text
language sql immutable
as $$
  select case
    when p_host is null or btrim(p_host) = '' then 'direct'
    when p_host ~* '(^|\.)(google|yandex|bing|duckduckgo|ecosia|baidu|rambler|yahoo|ya|sogou|qwant|naver|seznam)\.[a-z.]+$'
      or p_host ~* '^(go\.mail\.ru|search\.)' then 'search'
    when p_host ~* '(^|\.)(vk\.com|vk\.ru|ok\.ru|t\.me|telegram\.org|facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|t\.co|youtube\.com|youtu\.be|linkedin\.com|reddit\.com|tiktok\.com|whatsapp\.com|pinterest\.com|dzen\.ru|max\.ru)$' then 'social'
    when p_host ~ '^[0-9.:]+$' or p_host ~* '^localhost' then 'other'
    else 'external'
  end
$$;

-- ---------- приём событий ----------
-- p_events: массив объектов {t,p,s,v,d,b,o,r}
--   t — тип (page_view | session_start | session_end | event:<name>)
--   p — путь без query, s — id сессии, v — анонимный id посетителя,
--   d — desktop|mobile|tablet, b — браузер, o — ОС, r — hostname внешнего реферера.
-- Страна берётся из заголовка CDN (cf-ipcountry), если он есть; IP не сохраняется.
create or replace function public.cc_track_events(p_service text, p_events jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_enabled jsonb;
  v_country text;
  v_recent  integer;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) = 0 or jsonb_array_length(p_events) > 20 then
    return;
  end if;

  select st.value into v_enabled from public.cc_system_settings st where st.key = 'analytics.enabled';
  if v_enabled = 'false'::jsonb then
    return;
  end if;

  select sv.id into v_id from public.cc_services sv where sv.slug = p_service and sv.is_enabled;
  if v_id is null then
    return;
  end if;

  -- Ограничение частоты: не более 120 событий в минуту на посетителя.
  select count(*)::integer into v_recent
  from public.cc_analytics_events ev
  where ev.anonymous_visitor_id = left(coalesce(p_events -> 0 ->> 'v', ''), 64)
    and ev.created_at > now() - interval '1 minute';
  if v_recent >= 120 then
    return;
  end if;

  begin
    v_country := upper(nullif((current_setting('request.headers', true)::json) ->> 'cf-ipcountry', ''));
  exception when others then
    v_country := null;
  end;
  if v_country is null or v_country !~ '^[A-Z]{2}$' or v_country in ('XX', 'T1') then
    v_country := null;
  end if;

  insert into public.cc_analytics_events
    (service_id, event_type, page_path, session_id, anonymous_visitor_id,
     device_type, browser, operating_system, referrer, country)
  select
    v_id,
    e ->> 't',
    left(e ->> 'p', 256),
    left(e ->> 's', 64),
    left(e ->> 'v', 64),
    case when e ->> 'd' in ('desktop', 'mobile', 'tablet') then e ->> 'd' else 'other' end,
    left(e ->> 'b', 64),
    left(e ->> 'o', 64),
    left(e ->> 'r', 253),
    v_country
  from jsonb_array_elements(p_events) e
  where jsonb_typeof(e) = 'object'
    and (e ->> 't' in ('page_view', 'session_start', 'session_end')
         or e ->> 't' ~ '^event:[a-z0-9_.-]{1,48}$')
    and char_length(coalesce(e ->> 's', '')) >= 8
    and char_length(coalesce(e ->> 'v', '')) >= 8;
end $$;

-- ---------- отчёты (только администраторы) ----------

-- Заменяет функцию из миграции 0002 версией с фильтром по сервису и заполнением пустых интервалов.
drop function if exists public.cc_visits_series(timestamptz, timestamptz, text, text);

create or replace function public.cc_analytics_series(
  p_from timestamptz, p_to timestamptz,
  p_bucket text default 'day', p_tz text default 'UTC', p_service uuid default null
)
returns table (bucket timestamptz, visitors bigint, sessions bigint, page_views bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_step  interval;
  v_upper timestamptz := least(p_to, now());
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day', 'month') then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;
  v_step := case p_bucket when 'hour' then interval '1 hour' when 'day' then interval '1 day' else interval '1 month' end;

  return query
  with b as (
    select gs as ts
    from generate_series(
      date_trunc(p_bucket, p_from at time zone p_tz),
      date_trunc(p_bucket, v_upper at time zone p_tz),
      v_step
    ) gs
  ),
  agg as (
    select date_trunc(p_bucket, e.created_at at time zone p_tz) as ts,
           count(distinct e.anonymous_visitor_id) as vi,
           count(distinct e.session_id) as se,
           count(*) filter (where e.event_type = 'page_view') as pv
    from public.cc_analytics_events e
    where e.created_at >= p_from and e.created_at < p_to
      and (p_service is null or e.service_id = p_service)
    group by 1
  )
  select b.ts at time zone p_tz, coalesce(agg.vi, 0), coalesce(agg.se, 0), coalesce(agg.pv, 0)
  from b left join agg on agg.ts = b.ts
  order by b.ts;
end $$;

-- Сводка: посетители, сессии, просмотры, новые/вернувшиеся, средняя длительность сессии, прошлый период.
-- «Новый» — посетитель, чьё первое событие (по выбранному сервису или по всем) попало в период.
-- Длительность сессии = последнее − первое событие сессии; считается по сессиям из 2+ событий, до 4 ч.
create or replace function public.cc_analytics_overview(
  p_from timestamptz, p_to timestamptz, p_service uuid default null
)
returns table (
  visitors bigint, sessions bigint, page_views bigint,
  new_visitors bigint, returning_visitors bigint, avg_session_seconds numeric,
  prev_visitors bigint, prev_sessions bigint, prev_page_views bigint
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_prev timestamptz := p_from - (p_to - p_from);
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with cur as (
    select e.anonymous_visitor_id as v, e.session_id as s, e.event_type as t, e.created_at as c
    from public.cc_analytics_events e
    where e.created_at >= p_from and e.created_at < p_to
      and (p_service is null or e.service_id = p_service)
  ),
  vis as (select distinct v from cur),
  firsts as (
    select e.anonymous_visitor_id as v, min(e.created_at) as f
    from public.cc_analytics_events e
    where e.anonymous_visitor_id in (select v from vis)
      and (p_service is null or e.service_id = p_service)
    group by 1
  ),
  sess as (
    select s, extract(epoch from max(c) - min(c)) as d, count(*) as n from cur group by s
  ),
  prv as (
    select count(distinct e.anonymous_visitor_id) as pv,
           count(distinct e.session_id) as ps,
           count(*) filter (where e.event_type = 'page_view') as pp
    from public.cc_analytics_events e
    where e.created_at >= v_prev and e.created_at < p_from
      and (p_service is null or e.service_id = p_service)
  )
  select
    (select count(*) from vis),
    (select count(*) from sess),
    (select count(*) from cur where t = 'page_view'),
    (select count(*) from firsts where f >= p_from),
    (select count(*) from firsts where f < p_from),
    (select round(avg(least(d, 14400))) from sess where n > 1),
    prv.pv, prv.ps, prv.pp
  from prv;
end $$;

create or replace function public.cc_analytics_top_pages(
  p_from timestamptz, p_to timestamptz, p_service uuid default null, p_limit integer default 10
)
returns table (service_id uuid, page_path text, views bigint, visitors bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select e.service_id, coalesce(e.page_path, '/'), count(*), count(distinct e.anonymous_visitor_id)
  from public.cc_analytics_events e
  where e.event_type = 'page_view'
    and e.created_at >= p_from and e.created_at < p_to
    and (p_service is null or e.service_id = p_service)
  group by 1, 2
  order by 3 desc, 2
  limit least(greatest(p_limit, 1), 50);
end $$;

create or replace function public.cc_analytics_by_service(p_from timestamptz, p_to timestamptz)
returns table (service_id uuid, visitors bigint, sessions bigint, page_views bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select e.service_id,
         count(distinct e.anonymous_visitor_id),
         count(distinct e.session_id),
         count(*) filter (where e.event_type = 'page_view')
  from public.cc_analytics_events e
  where e.created_at >= p_from and e.created_at < p_to
  group by e.service_id
  order by 2 desc;
end $$;

-- Разбивки. p_dim: source | device | os | browser | country.
-- source считается по сессиям (session_start), остальные — по уникальным посетителям.
create or replace function public.cc_analytics_breakdown(
  p_from timestamptz, p_to timestamptz, p_dim text,
  p_service uuid default null, p_limit integer default 8
)
returns table (label text, visitors bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cc_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_dim not in ('source', 'device', 'os', 'browser', 'country') then
    raise exception 'invalid dimension' using errcode = '22023';
  end if;

  if p_dim = 'source' then
    return query
    select public.cc_classify_referrer(e.referrer), count(distinct e.session_id)
    from public.cc_analytics_events e
    where e.event_type = 'session_start'
      and e.created_at >= p_from and e.created_at < p_to
      and (p_service is null or e.service_id = p_service)
    group by 1
    order by 2 desc;
  else
    return query
    select
      case p_dim
        when 'device'  then coalesce(e.device_type, 'other')
        when 'os'      then coalesce(e.operating_system, 'Unknown')
        when 'browser' then coalesce(e.browser, 'Unknown')
        else e.country
      end,
      count(distinct e.anonymous_visitor_id)
    from public.cc_analytics_events e
    where e.created_at >= p_from and e.created_at < p_to
      and (p_service is null or e.service_id = p_service)
      and (p_dim <> 'country' or e.country is not null)
    group by 1
    order by 2 desc
    limit least(greatest(p_limit, 1), 50);
  end if;
end $$;

-- ---------- права ----------
revoke all on function public.cc_track_events(text, jsonb)                                        from public;
revoke all on function public.cc_analytics_series(timestamptz, timestamptz, text, text, uuid)     from public, anon;
revoke all on function public.cc_analytics_overview(timestamptz, timestamptz, uuid)               from public, anon;
revoke all on function public.cc_analytics_top_pages(timestamptz, timestamptz, uuid, integer)     from public, anon;
revoke all on function public.cc_analytics_by_service(timestamptz, timestamptz)                   from public, anon;
revoke all on function public.cc_analytics_breakdown(timestamptz, timestamptz, text, uuid, integer) from public, anon;

grant execute on function public.cc_track_events(text, jsonb)                                     to anon, authenticated;
grant execute on function public.cc_analytics_series(timestamptz, timestamptz, text, text, uuid)  to authenticated;
grant execute on function public.cc_analytics_overview(timestamptz, timestamptz, uuid)            to authenticated;
grant execute on function public.cc_analytics_top_pages(timestamptz, timestamptz, uuid, integer)  to authenticated;
grant execute on function public.cc_analytics_by_service(timestamptz, timestamptz)                to authenticated;
grant execute on function public.cc_analytics_breakdown(timestamptz, timestamptz, text, uuid, integer) to authenticated;

-- Откат (вручную):
--   drop function if exists public.cc_analytics_breakdown(timestamptz, timestamptz, text, uuid, integer),
--     public.cc_analytics_by_service(timestamptz, timestamptz),
--     public.cc_analytics_top_pages(timestamptz, timestamptz, uuid, integer),
--     public.cc_analytics_overview(timestamptz, timestamptz, uuid),
--     public.cc_analytics_series(timestamptz, timestamptz, text, text, uuid),
--     public.cc_track_events(text, jsonb), public.cc_classify_referrer(text);
--   drop index if exists public.cc_events_visitor_idx;
