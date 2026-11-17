-- =====================================================================
-- Opus Revenue Desk — Supabase schema (tables, views, RLS, seed data)
-- Run once in Supabase: SQL Editor -> New query -> paste all -> Run.
-- Safe to re-run: tables use IF NOT EXISTS and seeds skip existing rows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reference tables
-- ---------------------------------------------------------------------
create table if not exists public.properties (
  code         text primary key,                 -- OPUS, IMPERIAL, BANYAN
  name         text not null,
  ezee_name    text not null unique,             -- hotel name printed on eZee exports
  total_rooms  int  not null check (total_rooms > 0),
  created_at   timestamptz not null default now()
);

create table if not exists public.room_types (
  id             bigint generated always as identity primary key,
  property_code  text not null references public.properties(code) on delete cascade,
  name           text not null,                  -- must match the eZee room type name
  rooms          int  check (rooms is null or rooms >= 0),   -- inventory; needed for room-type RevPAR/occupancy
  base_rate      numeric(10,2) not null check (base_rate > 0),
  min_rate       numeric(10,2) not null,
  max_rate       numeric(10,2) not null,
  active         boolean not null default true,
  sort           int not null default 0,
  unique (property_code, name),
  check (min_rate <= base_rate and base_rate <= max_rate)
);

-- ---------------------------------------------------------------------
-- 2. Data loaded from uploads
-- ---------------------------------------------------------------------
-- eZee "Monthly Statistics" export: one row per hotel per day (past = actual, future = on the books)
create table if not exists public.daily_stats (
  property_code    text not null references public.properties(code) on delete cascade,
  stay_date        date not null,
  available_rooms  int,
  nights_sold      numeric(8,2),
  complimentary    int,
  occupancy_pct    numeric(6,2),
  adr              numeric(10,2),
  revpar           numeric(10,2),
  pax              int,
  room_charges     numeric(12,2),
  extra_charges    numeric(12,2),
  tax              numeric(12,2),
  source_file      text,
  is_sample        boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (property_code, stay_date)
);

-- eZee reservation list: one row per booked room (guest names are never stored)
create table if not exists public.reservations (
  id               bigint generated always as identity primary key,
  property_code    text not null references public.properties(code) on delete cascade,
  res_key          text not null,                -- reservation no. + room line, used to de-duplicate re-uploads
  res_no           text,
  booking_date     date,
  arrival          date not null,
  departure        date not null,
  nights           int generated always as (departure - arrival) stored,
  room_type        text,
  nationality      text,
  business_source  text,
  status           text,
  room_revenue     numeric(12,2) not null default 0,
  source_file      text,
  is_sample        boolean not null default false,
  updated_at       timestamptz not null default now(),
  unique (property_code, res_key),
  check (departure > arrival)
);

-- Lighthouse Rate Insight: one row per snapshot x stay date x hotel x channel
create table if not exists public.competitor_rates (
  id             bigint generated always as identity primary key,
  property_code  text not null references public.properties(code) on delete cascade,
  snapshot_date  date not null,                  -- the day the rates were shopped / exported
  stay_date      date not null,
  hotel_name     text not null,
  is_own         boolean not null default false,
  channel        text not null default 'Lowest',
  rate           numeric(10,2),                  -- null when sold out / no rate
  is_sold_out    boolean not null default false,
  currency       text not null default 'MYR',
  is_sample      boolean not null default false,
  unique (property_code, snapshot_date, stay_date, hotel_name, channel)
);

-- Lighthouse Market Insight: KL demand per stay date
create table if not exists public.market_demand (
  id             bigint generated always as identity primary key,
  area           text not null default 'Kuala Lumpur',
  snapshot_date  date not null,
  stay_date      date not null,
  demand_pct     numeric(5,1),                   -- 0-100 market demand
  market_adr     numeric(10,2),                  -- optional market price, if exported
  is_sample      boolean not null default false,
  unique (area, snapshot_date, stay_date)
);

-- OTA review ratings, entered monthly (own hotel + competitors)
create table if not exists public.ota_ratings (
  id             bigint generated always as identity primary key,
  property_code  text not null references public.properties(code) on delete cascade,
  month          date not null,                  -- first day of the month
  platform       text not null check (platform in ('Agoda','Booking.com','Trip.com')),
  hotel_name     text not null,
  is_own         boolean not null default false,
  rating         numeric(4,2) not null,
  scale          numeric(4,1) not null default 10,
  review_count   int,
  is_sample      boolean not null default false,
  unique (property_code, month, platform, hotel_name)
);

-- AI / rules strategy write-ups kept for the dashboard
create table if not exists public.ai_summaries (
  id             bigint generated always as identity primary key,
  property_code  text references public.properties(code) on delete cascade,
  period_label   text,
  content        text not null,
  model          text,
  created_at     timestamptz not null default now()
);

-- Import log
create table if not exists public.uploads (
  id             bigint generated always as identity primary key,
  kind           text not null check (kind in ('ezee_daily','ezee_reservations','lighthouse_rates','lighthouse_demand')),
  property_code  text references public.properties(code) on delete set null,
  file_name      text,
  row_count      int,
  uploaded_at    timestamptz not null default now()
);

create index if not exists reservations_arrival_idx on public.reservations (property_code, arrival);
create index if not exists competitor_rates_stay_idx on public.competitor_rates (property_code, stay_date, snapshot_date);
create index if not exists market_demand_stay_idx on public.market_demand (stay_date, snapshot_date);

-- ---------------------------------------------------------------------
-- 3. Views used by the dashboard (security_invoker so RLS still applies)
-- ---------------------------------------------------------------------
-- Each reservation expanded into one row per room night; cancellations and no-shows excluded
create or replace view public.v_reservation_nights with (security_invoker = true) as
select r.property_code,
       r.room_type,
       coalesce(nullif(trim(r.nationality), ''), 'Unknown') as nationality,
       r.business_source,
       g.d::date                        as stay_date,
       r.room_revenue / r.nights        as night_revenue,
       r.is_sample
from public.reservations r
cross join lateral generate_series(r.arrival::timestamp, (r.departure - 1)::timestamp, interval '1 day') as g(d)
where lower(coalesce(r.status, '')) !~ '(cancel|no.?show|void)';

-- Room-type contribution per month
create or replace view public.v_room_type_month with (security_invoker = true) as
with nights as (
  select property_code, date_trunc('month', stay_date)::date as month, room_type,
         count(*)::int as room_nights, sum(night_revenue) as revenue
  from public.v_reservation_nights
  group by 1, 2, 3
), months as (
  select distinct n.property_code, n.month,
         ((n.month + interval '1 month')::date - n.month) as days_in_month
  from nights n
), capacity as (
  select m.property_code, m.month, m.days_in_month,
         case when ds.days = m.days_in_month then ds.avail
              else p.total_rooms * m.days_in_month end as available_room_nights
  from months m
  join public.properties p on p.code = m.property_code
  left join lateral (
    select sum(d.available_rooms) as avail, count(*)::int as days
    from public.daily_stats d
    where d.property_code = m.property_code
      and date_trunc('month', d.stay_date)::date = m.month
  ) ds on true
)
select n.property_code, n.month, n.room_type, n.room_nights,
       round(n.revenue, 2)                                                        as revenue,
       round(n.revenue / nullif(n.room_nights, 0), 2)                             as adr,
       round(n.revenue / nullif(sum(n.revenue) over (partition by n.property_code, n.month), 0), 4) as revenue_share,
       round(n.revenue / nullif(c.available_room_nights, 0), 2)                   as revpar_contribution,
       rt.rooms,
       case when rt.rooms > 0 then round(n.revenue / (rt.rooms * c.days_in_month), 2) end        as room_type_revpar,
       case when rt.rooms > 0 then round(n.room_nights::numeric / (rt.rooms * c.days_in_month), 4) end as room_type_occ
from nights n
join capacity c on c.property_code = n.property_code and c.month = n.month
left join public.room_types rt on rt.property_code = n.property_code and lower(rt.name) = lower(n.room_type);

-- Nationality ADR per month
create or replace view public.v_nationality_month with (security_invoker = true) as
with g as (
  select property_code, date_trunc('month', stay_date)::date as month, nationality,
         count(*)::int as room_nights, sum(night_revenue) as revenue
  from public.v_reservation_nights
  group by 1, 2, 3
)
select property_code, month, nationality, room_nights,
       round(revenue, 2)                                  as revenue,
       round(revenue / nullif(room_nights, 0), 2)         as adr,
       round(revenue / nullif(sum(revenue) over (partition by property_code, month), 0), 4) as revenue_share
from g;

-- Rooms on the books per stay date and room type (from reservations)
create or replace view public.v_otb_room_type with (security_invoker = true) as
select property_code, stay_date, room_type, count(*)::int as rooms_sold, round(sum(night_revenue), 2) as revenue
from public.v_reservation_nights
group by 1, 2, 3;

-- Latest competitor snapshot per stay date: own rate vs compset
create or replace view public.v_compset_latest with (security_invoker = true) as
with latest as (
  select distinct on (property_code, stay_date) property_code, stay_date, snapshot_date
  from public.competitor_rates
  order by property_code, stay_date, snapshot_date desc
)
select c.property_code, c.stay_date, l.snapshot_date,
       min(c.rate) filter (where c.is_own)                                                   as own_rate,
       round((percentile_cont(0.5) within group (order by c.rate) filter (where not c.is_own and c.rate is not null))::numeric, 2) as compset_median,
       min(c.rate) filter (where not c.is_own)                                               as compset_min,
       max(c.rate) filter (where not c.is_own)                                               as compset_max,
       count(*) filter (where not c.is_own and c.rate is not null)::int                      as competitors_with_rate,
       count(*) filter (where not c.is_own and c.is_sold_out)::int                           as competitors_sold_out
from public.competitor_rates c
join latest l on l.property_code = c.property_code and l.stay_date = c.stay_date and l.snapshot_date = c.snapshot_date
group by 1, 2, 3;

-- Latest KL demand per stay date
create or replace view public.v_demand_latest with (security_invoker = true) as
select distinct on (area, stay_date) area, stay_date, snapshot_date, demand_pct, market_adr
from public.market_demand
order by area, stay_date, snapshot_date desc;

-- ---------------------------------------------------------------------
-- 4. Access: Row Level Security
-- DEMO MODE: no login, so the publishable/anon key can read and write.
-- Anyone who has the live URL can see and change this data.
-- Switch to the "team login" policies (PLAN.md section 11) before real data goes in.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['properties','room_types','daily_stats','reservations','competitor_rates',
                           'market_demand','ota_ratings','ai_summaries','uploads']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists demo_open_access on public.%I', t);
    execute format('create policy demo_open_access on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Seed: your three hotels and room types (base rates = Sep 2026 ADR, edit in the tool)
-- ---------------------------------------------------------------------
insert into public.properties (code, name, ezee_name, total_rooms) values
  ('OPUS',     'Opus Residences',   'Opus Residences by Opus Hospitality',   46),
  ('IMPERIAL', 'Imperial KLCC',     'Imperial KLCC by Opus Hospitality',     40),
  ('BANYAN',   'Banyan Signatures', 'Banyan Signatures by Opus Hospitality', 96)
on conflict (code) do nothing;

insert into public.room_types (property_code, name, base_rate, min_rate, max_rate, sort) values
  ('BANYAN',   'DELUXE TWIN',                                   310, 220,  500, 1),
  ('BANYAN',   'DELUXE KING',                                   355, 250,  570, 2),
  ('BANYAN',   'DELUXE TRIPLE',                                 420, 295,  670, 3),
  ('BANYAN',   'SIGNATURE DELUXE KING SUITE',                   510, 360,  815, 4),
  ('IMPERIAL', 'Prestige 2BR Deluxe City View Suite',           415, 290,  665, 1),
  ('IMPERIAL', 'Prestige 2BR Deluxe KLCC Executive View Suite', 460, 320,  735, 2),
  ('IMPERIAL', 'Prestige 3BR Deluxe City View Family Suite',    680, 475, 1090, 3),
  ('IMPERIAL', 'Atelier Grand Deluxe',                          785, 550, 1255, 4),
  ('OPUS',     '1BR DELUXE',                                    180, 125,  290, 1),
  ('OPUS',     '1BR SIGNATURE',                                 185, 130,  295, 2),
  ('OPUS',     '3BR',                                           220, 155,  350, 3),
  ('OPUS',     '2BR DELUXE',                                    245, 170,  390, 4),
  ('OPUS',     '2(1)BR DELUXE',                                 255, 180,  410, 5),
  ('OPUS',     '3BR DELUXE',                                    275, 195,  440, 6),
  ('OPUS',     '3BR SIGNATURE',                                 310, 215,  495, 7),
  ('OPUS',     '3BR PRESIDENTIAL SUITE',                        350, 245,  560, 8),
  ('OPUS',     'FAMILY SUITE (10-12)',                          580, 405,  930, 9)
on conflict (property_code, name) do nothing;

-- ---------------------------------------------------------------------
-- 6. Seed: SAMPLE data so the dashboard is not empty (is_sample = true).
-- Dates are relative to today. Remove it any time with "Remove sample data" in Settings.
-- ---------------------------------------------------------------------
do $$
declare
  p record; rt record; d date; i int; arr date; n int; nat text; src text; f numeric;
  start_d date := (date_trunc('month', current_date) - interval '1 month')::date;
  end_d   date := (date_trunc('month', current_date) + interval '2 month' - interval '1 day')::date;
  nats text[] := array['Malaysia','Malaysia','Malaysia','Singapore','China','China','Indonesia','Saudi Arabia',
                       'Australia','United Kingdom','India','Japan','South Korea','United States'];
  nat_factor numeric[] := array[0.92,0.92,0.92,1.05,1.00,1.00,0.95,1.25,1.10,1.12,0.90,1.08,1.03,1.15];
  srcs text[] := array['AGODA','AGODA','BOOKING.COM','CTRIP','Tiket.com','Direct','Direct','Corporate'];
  comps text[] := array['Sample Competitor A','Sample Competitor B','Sample Competitor C','Sample Competitor D'];
  comp_factor numeric[] := array[0.92, 1.05, 1.15, 0.85];
  lead numeric; occ numeric; sold int; adr_v numeric; k int; snap date;
begin
  if exists (select 1 from public.reservations where is_sample) then
    return;  -- sample data already loaded
  end if;

  for p in select * from public.properties loop
    select min(base_rate) into lead from public.room_types where property_code = p.code;

    -- daily stats (past = actual, future = thinner on-the-books)
    d := start_d;
    while d <= end_d loop
      occ := case when d < current_date then 0.55 + random()::numeric * 0.35
                  else greatest(0.08, 0.80 - (d - current_date) * 0.012 + random()::numeric * 0.10) end;
      if extract(isodow from d) in (5, 6) then occ := least(1, occ + 0.08); end if;
      sold  := round(p.total_rooms * occ);
      adr_v := round(lead * (1.05 + random()::numeric * 0.25), 2);
      insert into public.daily_stats (property_code, stay_date, available_rooms, nights_sold, complimentary,
                                      occupancy_pct, adr, revpar, pax, room_charges, extra_charges, tax, is_sample)
      values (p.code, d, p.total_rooms, sold, 0,
              round(sold * 100.0 / p.total_rooms, 2), adr_v, round(adr_v * sold / p.total_rooms, 2),
              round(sold * 2.6), round(adr_v * sold, 2), round(random()::numeric * 600, 2),
              round(adr_v * sold * 0.18, 2), true)
      on conflict (property_code, stay_date) do nothing;
      d := d + 1;
    end loop;

    -- reservations
    -- roughly 60% occupancy for past dates, thinning out for future dates (like real on-the-books)
    for i in 1..(p.total_rooms * 22) loop
      arr := start_d + floor(random()::numeric * (end_d - start_d - 3))::int;
      continue when arr > current_date and random()::numeric > greatest(0.15, 1 - (arr - current_date) / 70.0);
      select * into rt from public.room_types where property_code = p.code order by random()::numeric limit 1;
      n   := 1 + floor(random()::numeric * 4)::int;
      k   := 1 + floor(random()::numeric * array_length(nats, 1))::int;
      nat := nats[k]; f := nat_factor[k];
      src := srcs[1 + floor(random()::numeric * array_length(srcs, 1))::int];
      insert into public.reservations (property_code, res_key, res_no, booking_date, arrival, departure,
                                       room_type, nationality, business_source, status, room_revenue, is_sample)
      values (p.code, 'SAMPLE-' || p.code || '-' || i, 'SAMPLE-' || i,
              arr - (3 + floor(random()::numeric * 40))::int, arr, arr + n,
              rt.name, nat, src,
              case when random()::numeric < 0.07 then 'Cancelled' else 'Confirmed' end,
              round(n * rt.base_rate * f * (0.88 + random()::numeric * 0.30), 2), true);
    end loop;

    -- competitor rates: two snapshots (a week ago and today) for the next 60 days
    foreach snap in array array[current_date - 7, current_date] loop
      for i in 0..59 loop
        d := current_date + i;
        insert into public.competitor_rates (property_code, snapshot_date, stay_date, hotel_name, is_own, rate, is_sample)
        values (p.code, snap, d, p.name, true,
                round(lead * (case when extract(isodow from d) in (5, 6) then 1.12 else 1.0 end) * (0.95 + random()::numeric * 0.10)), true)
        on conflict do nothing;
        for k in 1..array_length(comps, 1) loop
          insert into public.competitor_rates (property_code, snapshot_date, stay_date, hotel_name, is_own, rate, is_sold_out, is_sample)
          values (p.code, snap, d, comps[k], false,
                  case when random()::numeric < 0.04 then null
                       else round(lead * comp_factor[k] * (case when extract(isodow from d) in (5, 6) then 1.15 else 1.0 end)
                                  * (case when snap = current_date then 1.03 else 1.0 end) * (0.92 + random()::numeric * 0.16)) end,
                  false, true)
          on conflict do nothing;
        end loop;
      end loop;
    end loop;
    update public.competitor_rates set is_sold_out = true where is_sample and rate is null;

    -- OTA ratings for this month
    insert into public.ota_ratings (property_code, month, platform, hotel_name, is_own, rating, scale, is_sample)
    select p.code, date_trunc('month', current_date)::date, pl.platform, p.name, true,
           case p.code when 'BANYAN'   then (array[8.7, 8.1, 8.7])[pl.n]
                       when 'IMPERIAL' then (array[8.9, 8.8, 9.0])[pl.n]
                       else                 (array[8.7, 8.1, 8.1])[pl.n] end, 10, true
    from (values ('Agoda', 1), ('Booking.com', 2), ('Trip.com', 3)) as pl(platform, n)
    on conflict do nothing;
    insert into public.ota_ratings (property_code, month, platform, hotel_name, is_own, rating, scale, is_sample)
    select p.code, date_trunc('month', current_date)::date, pl, c, false, round((7.8 + random()::numeric * 1.4)::numeric, 1), 10, true
    from unnest(array['Agoda','Booking.com','Trip.com']) as pl, unnest(comps) as c
    on conflict do nothing;
  end loop;

  -- KL market demand for the next 90 days (two snapshots)
  foreach snap in array array[current_date - 7, current_date] loop
    for i in 0..89 loop
      d := current_date + i;
      insert into public.market_demand (snapshot_date, stay_date, demand_pct, is_sample)
      values (snap, d,
              least(98, greatest(8, round((42 + 18 * sin(i / 9.0) + (case when extract(isodow from d) in (5, 6) then 14 else 0 end)
                                          + (case when snap = current_date then 3 else 0 end) + random()::numeric * 10)::numeric, 1))),
              true)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
