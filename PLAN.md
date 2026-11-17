# Opus Revenue Desk — build plan

*Draft for your approval · 17 Nov 2026 · for Opus Hospitality (Opus Residences, Imperial KLCC, Banyan Signatures)*

---

## 1. Overview

**The problem.** Every month you pull revenue reports out of eZee and demand/competitor data out of Lighthouse for three hotels, then build the analysis and the strategy by hand in Excel and Word (the September/October revenue reports, the OTB report, Target vs Achieved). Deciding a rate for each room type on each date, working out which room types and nationalities bring the money, checking what competitors are charging and where you stand on Agoda, Booking.com and Trip.com are all done by copying and pasting.

**The users.** You (revenue) plus a few colleagues such as the GM and directors: about 2–10 people, all three hotels in one tool.

**The goal.** Upload the eZee and Lighthouse exports, and get rate recommendations for every room type and date plus a dashboard that answers your five questions automatically.

**What this plan is based on.** I read the files in your `Downloads\Reports` folder: the four eZee *Monthly Statistics* exports for November 2026 (`Report.xlsx`, `Report (1)–(3).xlsx`), the September revenue workbooks (room types and reviews tabs) and the Target vs Achieved workbook. I have no eZee reservation list or Lighthouse export yet (see section 11).

**Assumptions** (you skipped these questions, so tell me if any are wrong):

- **Users:** a small team sharing one tool, with no per-person roles.
- **Outside services:** spreadsheet upload is built in and needs no key. The AI write-up uses Google Gemini, which is free and optional.
- **Accounts:** you have a Supabase account with an empty project, **"Waysern AI Training"** (Singapore region), and I can create the tables there for you. I've assumed you don't have a Vercel account yet, so the sign-up steps are included.

---

## 2. Features

| # | Pain point today | Feature | Screen |
|---|---|---|---|
| 1 | eZee reports are analysed by hand, hotel by hotel | **Upload** eZee *Monthly Statistics* and *Reservation List* exports. The tool reads the hotel and month from the file and saves the data. Uploading the same file again updates it instead of creating duplicates. | Home › Upload |
| 2 | A rate for each room type and date is worked out manually | **Rate recommendations grid:** the next 60 days × every room type, each cell showing the suggested rate, the % change from base and the reasons behind it. Exports to CSV. | Home › Rates |
| 3 | "Which room type contributes the most revenue / RevPAR?" | **Room-type contribution:** revenue, share, ADR and RevPAR contribution per room type. Room-type RevPAR and occupancy also appear once room counts are entered. | Dashboard |
| 4 | "Which nationality brings the highest ADR?" | **Nationality ranking** by ADR (minimum 5 room nights, so one-off bookings don't top the list), with revenue share | Dashboard |
| 5 | "What are competitors doing and charging?" | **Compset view** from Lighthouse Rate Insight: your rate vs each competitor and the median, gap %, the biggest rate changes since the last upload, and sold-out flags | Dashboard |
| 6 | "Where do we stand on Agoda / Booking.com / Trip.com?" | **Monthly ratings form** (your hotel plus competitors, per platform) feeding a **positioning table**: rating vs compset, rank, price index and a verdict such as *"rated above compset but priced below median → room to raise"* | Home › OTA ratings (entry), Dashboard (view) |
| 7 | Turning the numbers into a strategy | **"Write strategy" button:** a rules-based summary that always works, plus an AI write-up via Gemini when a key is set. Past write-ups are kept. | Dashboard |

The daily occupancy/ADR chart also shows **KL market demand** from Lighthouse Market Insight.

### How a recommended rate is worked out (transparent rules, no black box)

For each hotel, room type and stay date in the next 60 days:

| Step | Signal | Source | Adjustment |
|---|---|---|---|
| 1 | Base rate | Room types tab (pre-filled from your Sep 2026 ADR per room type, editable) | Starting point |
| 2 | KL market demand | Lighthouse Market Insight, latest upload | below 25% → −8% · 25–45% → −3% · 45–65% → 0 · 65–80% → +6% · 80% and up → +12% |
| 3 | Hotel occupancy on the books | Future dates in the eZee Monthly Statistics export (or the reservation list if that's missing) | 85% and up → +10% · 70–85% → +5% · under 40% within 14 days → −7% |
| 4 | Room-type pickup (only once room counts are entered) | Reservation list | 90% sold and up → +5% · 30% or less within 14 days → −3% |
| 5 | Competitor guardrail | Lighthouse Rate Insight median for that date, compared against your cheapest room type | Your cheapest room type stays between **90% of the compset median** and **median + premium**. The premium depends on your average OTA rating vs the compset: 0.3 or more above → +10% · within ±0.3 → +3% · 0.3 or more below → −5%. All room types move by the same %. |
| 6 | Limits | Room types tab | Kept within each room type's min/max, rounded to the nearest RM 5 |

Hovering over a cell shows its reasoning, for example: *"Demand 78% +6% · On the books 88% +10% · capped at median +3% (RM 470)"*. If a signal has no data for a date, that step is skipped and flagged. All the thresholds sit in one place (`RULES` in `shared/app.js`), so they're easy to tune.

### Not in this demo

- Pulling data automatically from eZee or Lighthouse. Both need partner API access, so you upload exports instead.
- Scraping OTA sites.
- Budget/target tracking.
- Pushing rates back into eZee or a channel manager.

---

## 3. Folder structure (static HTML, no build step)

```
/index.html            -> landing page with two buttons: "Home" and "Dashboard"
/home/index.html       -> working screen: Upload · Rates · OTA ratings · Room types · Settings
/dashboard/index.html  -> dashboard: KPI cards, charts, tables, strategy write-up
/shared/app.js         -> config loader, Supabase client, file parsers, rate rules, helpers
/shared/styles.css     -> shared styles
/api/config.js         -> Vercel function: returns public Supabase values + which keys exist (never secrets)
/api/ai.js             -> Vercel function: calls Gemini server-side with GEMINI_API_KEY
/supabase/schema.sql   -> tables, views, RLS policies, seed + sample data
/vercel.json
/README.md
```

`index.html` only redirects: the **Home** button goes to `/home/` and the **Dashboard** button goes to `/dashboard/`.

Libraries load from a CDN, so there's nothing to install: **supabase-js v2** (database), **SheetJS** (reads `.xlsx`, `.xls` and `.csv` in the browser) and **Chart.js** (charts).

---

## 4. Supabase

### Tables

| Table | What it holds | Key columns | Filled by |
|---|---|---|---|
| `properties` | Your 3 hotels | `code` (OPUS / IMPERIAL / BANYAN), `name`, `ezee_name` (as printed on eZee exports), `total_rooms` | Seed |
| `room_types` | Room types per hotel | `name` (must match eZee), `base_rate`, `min_rate`, `max_rate`, `rooms` (inventory, optional), `active` | Seed, then edited in Home › Room types |
| `daily_stats` | eZee Monthly Statistics: one row per hotel per day | `stay_date`, `available_rooms`, `nights_sold`, `occupancy_pct`, `adr`, `revpar`, `room_charges`, … | Upload |
| `reservations` | eZee reservation list: one row per booked room | `res_key` (prevents duplicates), `arrival`, `departure`, `nights` (calculated), `room_type`, `nationality`, `business_source`, `status`, `room_revenue` | Upload |
| `competitor_rates` | Lighthouse Rate Insight | `snapshot_date`, `stay_date`, `hotel_name`, `is_own`, `channel`, `rate`, `is_sold_out` | Upload |
| `market_demand` | Lighthouse Market Insight (KL) | `snapshot_date`, `stay_date`, `demand_pct`, `market_adr` | Upload |
| `ota_ratings` | Monthly ratings | `month`, `platform` (Agoda / Booking.com / Trip.com), `hotel_name`, `is_own`, `rating`, `scale` | Home › OTA ratings |
| `ai_summaries` | Saved strategy write-ups | `property_code`, `period_label`, `content`, `model` | "Write strategy" button |
| `uploads` | Import log | `kind`, `file_name`, `row_count`, `uploaded_at` | Upload |

### Views the dashboard reads

These do the maths in the database. They use `security_invoker`, so RLS still applies.

- `v_reservation_nights` turns each reservation into one row per room night and leaves out cancellations and no-shows.
- `v_room_type_month` gives room nights, revenue, ADR, revenue share and RevPAR contribution per room type per month. It adds room-type RevPAR and occupancy once room counts exist.
- `v_nationality_month` gives room nights, revenue, ADR and revenue share per nationality per month.
- `v_otb_room_type` gives rooms on the books per date and room type.
- `v_compset_latest` gives your rate, the compset median/min/max and sold-out count per date, from the latest snapshot.
- `v_demand_latest` gives the latest KL demand per date.

### Relationships

`properties.code` links to `room_types`, `daily_stats`, `reservations`, `competitor_rates`, `ota_ratings`, `ai_summaries` and `uploads`. `market_demand` covers the whole city, so it isn't tied to one hotel.

### Data handling

- Guest names, emails and phone numbers in the reservation list are **dropped in the browser and never saved**.
- **Sample data** (`is_sample = true`) fills the dashboard on day one. It includes 3 months of daily stats and bookings, rates for four "Sample Competitor" hotels, KL demand and ratings, with all dates relative to today. A **"Remove sample data"** button in Settings deletes only those rows. Your three hotels and their room types are real (taken from your reports). Nothing else in the seed is real data.
- **Demo-mode security:** with no login, the policies let the browser key read and write every table. **Anyone with the live URL could see and change the data.** That's fine for sample data, but since you'll upload real revenue figures, see decision 1 in section 11.

<details>
<summary><strong>Full <code>supabase/schema.sql</code></strong> (tested on Postgres; safe to re-run)</summary>

```sql
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
```

</details>

---

## 5. Connect Supabase (first-run screen)

1. On load, `shared/app.js` calls `/api/config`. If Vercel has `SUPABASE_URL` and the key, it connects and never asks.
2. Otherwise it checks this browser's saved settings (`localStorage`).
3. If neither has them, it shows a **"Connect your Supabase"** panel with:
   - fields for **Project URL** and **Publishable key** (older projects call it the *anon key*)
   - a **Test connection** button, which reads `properties` and replies *"Connected — 3 hotels found"*, *"Connected, but the tables are missing — run schema.sql"* or the exact error
   - a link to [create a free Supabase project](https://supabase.com/dashboard)
   - a **Copy schema.sql** button, plus the steps to paste it into SQL Editor
4. Saved values are reused on the next visit, and a "Disconnect" button clears them.

**Shortcut:** Supabase is connected in this chat, so once you approve I can run `schema.sql` in **"Waysern AI Training"** and read its URL and publishable key for you. You'd skip this screen entirely.

---

## 6. API keys

| Key | Service | Why it's needed | Free? | Env var | Public or secret |
|---|---|---|---|---|---|
| Project URL | Supabase | The database address | Yes (free plan) | `SUPABASE_URL` | Public, safe in the browser |
| Publishable key (`sb_publishable_…`, or the legacy anon key) | Supabase | Lets the browser read and write, limited by RLS | Yes | `SUPABASE_ANON_KEY` (`SUPABASE_PUBLISHABLE_KEY` also accepted) | Public, safe in the browser |
| Gemini API key | Google AI Studio | AI strategy write-up. **Optional:** the rules summary works without it | Yes (free tier, no card) | `GEMINI_API_KEY` (plus optional `GEMINI_MODEL`, default `gemini-flash-latest`) | **Secret** |

**How the tool handles keys:**

- It calls `/api/config` first. If an env var exists on Vercel, the tool uses it and doesn't ask.
- If a key is missing, **Home › Settings** shows a box to paste it. The key is saved in this browser only (`localStorage`), next to a clear note: *demo only; never paste a secret key on a shared computer; move it to Vercel env vars for real use.*
- The Supabase URL and publishable key are public values, so the browser uses them directly.
- When `GEMINI_API_KEY` is set on Vercel, AI calls go through `/api/ai`, so the key never reaches the browser. Only when it's pasted in Settings (demo) does the browser call Gemini directly.
- A **"Required keys" checklist** in Settings shows each key as **Found (Vercel)**, **Found (this browser)** or **Missing**.
- **Data note:** on Gemini's free tier, Google may use the prompts to improve its products. The tool therefore sends only aggregated figures (KPIs, room-type and nationality totals, compset gaps), never guest-level data.

---

## 7. API key guide and checklist

See **`API_KEYS_GUIDE.md`**. It covers every key, step by step from sign-up to copying it, with a checklist, the free-tier limits, the exact env var names and where to paste each one.

---

## 8. Build steps

1. **Database:** run `schema.sql` in "Waysern AI Training" through the connector (or you run it yourself), then check Supabase's security advisor.
2. **Shared layer:** `styles.css` and `app.js` (config loader, Connect panel, keys checklist, Supabase client, number/date helpers).
3. **File parsers:**
   - *eZee Monthly Statistics:* detects the hotel from the title line (e.g. "Imperial KLCC by Opus Hospitality") and the month from "Month November,2026", reads rows "1 Sun … 30 Mon", and stops at "Total".
   - *eZee reservation list:* guesses the columns, shows a mapping step for anything it can't match, remembers the mapping, and drops guest-identity columns.
   - *Lighthouse Rate Insight:* handles both the wide layout (one column per hotel) and the long layout (Date / Hotel / Rate), asks which hotel is yours, and treats "sold out" as a flag.
   - *Lighthouse Market Insight:* reads Date and Demand %, plus market price if it's present.
4. **`index.html`** landing page.
5. **Home:**
   - **Upload:** file picker, preview of detected hotel/month/rows, Import, upload log.
   - **Rates:** hotel picker, 60-day × room-type grid with colour coding and reasons, CSV export.
   - **OTA ratings:** monthly form.
   - **Room types:** edit base/min/max/room counts and each hotel's total rooms.
   - **Settings:** connection, keys checklist, remove sample data.
6. **Dashboard**, in order:
   - hotel and month filters
   - a portfolio strip (Occ/ADR/RevPAR for all three hotels)
   - KPI cards
   - daily occupancy/ADR chart with KL demand
   - room-type contribution chart and table
   - nationality ADR ranking
   - competitor rate chart and "biggest moves" table
   - OTA positioning table
   - strategy write-up panel with history
7. **`/api/config.js`, `/api/ai.js`, `vercel.json` and `README.md`.**
8. **Empty and error states** everywhere: not connected, tables missing, no data for this hotel/month, missing key, unreadable file.
9. **Test locally** with your real November eZee exports against Supabase, fix what turns up, deliver.

---

## 9. Testing checklist

- [ ] The landing page's **Home** and **Dashboard** buttons open `/home/` and `/dashboard/`.
- [ ] With no config, the Connect panel appears. A wrong key shows a clear error; the right key shows "Connected — 3 hotels found".
- [ ] **Copy schema.sql** copies the file.
- [ ] Settings › Required keys shows Found/Missing correctly.
- [ ] Uploading `Report.xlsx` is detected as **Opus Residences, November 2026, 30 days** and saves. Uploading it again still gives 30 rows (updated, not duplicated).
- [ ] `Report (1)–(3).xlsx` are each matched to the right hotel.
- [ ] A reservation list upload shows the mapping step, ignores the guest-name column and saves the rows.
- [ ] Lighthouse Rate Insight and Market Insight uploads save, with the snapshot date set.
- [ ] Rates shows 60 days × room types, and hovering shows the reasons. Changing a base rate in Room types changes the grid. The CSV opens in Excel.
- [ ] Saving this month's OTA ratings updates the Dashboard positioning table.
- [ ] Dashboard KPIs for **Opus Residences, Nov 2026** match the eZee Total row: **Occ 64.98% · ADR RM 230.96 · RevPAR RM 150.07**.
- [ ] Room-type and nationality tables respond to the hotel/month filters.
- [ ] **Write strategy** gives a rules summary with no key and an AI write-up with a key, and both are saved and shown in the history.
- [ ] **Remove sample data** removes the sample rows and keeps your uploads.
- [ ] **Round trip:** a base rate edited in Home shows in Supabase › Table Editor and on the Dashboard after a refresh.

---

## 10. Deploy to Vercel (last step)

1. Put the folder in a **private** GitHub repo, or run `npx vercel` from inside the folder.
2. On [vercel.com](https://vercel.com): **Add New → Project →** import the repo. Use framework preset **Other**, with no build command and the root folder as output.
3. Under **Settings → Environment Variables**, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (paste the publishable key). Optionally add `GEMINI_API_KEY` and `GEMINI_MODEL`.
4. **Deploy**, then open the live URL. Home › Settings should show every key as **Found (Vercel)**.
5. Run the testing checklist (section 9) on the live site.

> **Plan note:** Vercel's free **Hobby** plan is limited to personal, non-commercial use. It's fine for building and trying the demo, but a tool your hotels use for business needs **Vercel Pro** (from $20/month) or another host. Supabase's free plan also **pauses a project after 7 days without activity**. One click in the Supabase dashboard un-pauses it.

---

## 11. Decisions before I build

1. **Security for real data.**
   - **(a) Demo mode:** open policies as in `schema.sql`, using sample data only.
   - **(b) Team login (recommended):** email + password accounts that you create in Supabase › Authentication (public sign-ups off). Policies become `to authenticated` only, and the tool gets a simple sign-in screen.

   Because you'll upload real revenue and nationality data, I recommend (b).
2. **Where the tables go:** I create them in "Waysern AI Training" through the connector, or you run `schema.sql` yourself in a project of your choice.
3. **Sample exports (helpful, not blocking):** if you drop one **eZee reservation list** export and one **Lighthouse Rate Insight** and **Market Insight** export into `Downloads\Reports`, I'll fit the importers to their exact columns. Without them, the importers use the column-mapping step.
4. **Room counts per room type (optional):** these are needed for room-type RevPAR and occupancy. You can type them into Home › Room types any time.
5. **Where the files go:** I build in my workspace and send you the files. I can also write the finished folder to your PC (e.g. `Documents\opus-revenue-desk`) so it's ready to push to GitHub.
