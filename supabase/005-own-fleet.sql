-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 005: our own fleet, kept apart from the
-- subcontractor registrations.
--
-- The submissions/equipment tables answer "which Venezuelan
-- company owns this machine". The ANSAD register answers a
-- different question: of the machines we already control in
-- Trinidad, how many are there, how many do we need in
-- Venezuela, and are they ready to move. Quantity and
-- readiness are the whole point, so they get their own tables
-- rather than being flattened into equipment rows.
--
-- Run AFTER schema.sql. Safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Equipment types, with the quantities that matter
-- ---------------------------------------------------------

create table if not exists public.fleet_items (
  id            uuid primary key default gen_random_uuid(),
  owner         text not null default 'ANSAD',
  ref           text,                       -- A01, A02 … from the register
  equipment     text not null,              -- Excavator, Wheel Loader …
  make          text,                       -- Caterpillar, Mack …
  model         text,                       -- 349, 980H / 980K …
  qty_available integer not null default 0, -- what the owner has
  qty_required  integer not null default 0, -- what we need in Venezuela
  intended_use  text,
  notes         text,
  -- Capacity in metric tonnes. Given where the file states it, otherwise
  -- read off the model number (see capacity_source).
  capacity_t      numeric(6,1),
  capacity_source text check (capacity_source in ('stated', 'model', 'unknown'))
                  default 'unknown',
  location      text not null default 'Trinidad and Tobago',
  created_at    timestamptz not null default now()
);

comment on table public.fleet_items is
  'Equipment types we own or control, with how many exist and how many are needed in Venezuela.';
comment on column public.fleet_items.capacity_source is
  'stated = the file gave a capacity. model = inferred from the model number. unknown = neither.';

-- ---------------------------------------------------------
-- 2. The individual units behind those quantities
--
-- Mostly empty today: the register lists 113 unit slots with only a
-- reference and a model. The columns are here so ANSAD can fill them in
-- without another migration.
-- ---------------------------------------------------------

create table if not exists public.fleet_units (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid references public.fleet_items(id) on delete set null,
  owner         text not null default 'ANSAD',
  ref           text,                -- ANSAD-CAT-EXC-349-01
  unit_no       text,
  equipment     text,
  make          text,
  model         text,
  year          integer,
  serial_vin    text,
  hours         text,
  capacity      text,
  engine        text,
  attachments   text,
  condition     text,
  location      text,
  service_notes text,
  export_ready  text,
  lead_time     text,
  price         text,
  comments      text,
  created_at    timestamptz not null default now()
);

comment on table public.fleet_units is
  'One row per physical unit in the mobilization register. Most detail columns are still to be supplied by the owner.';

create index if not exists fleet_items_owner_idx on public.fleet_items (owner);
create index if not exists fleet_items_equip_idx on public.fleet_items (equipment);
create index if not exists fleet_units_item_idx  on public.fleet_units (item_id);
create index if not exists fleet_units_owner_idx on public.fleet_units (owner);

-- ---------------------------------------------------------
-- 3. Row-level security — same rule as everything else
-- ---------------------------------------------------------

alter table public.fleet_items enable row level security;
alter table public.fleet_units enable row level security;

drop policy if exists "admins read fleet_items"   on public.fleet_items;
drop policy if exists "admins write fleet_items"  on public.fleet_items;
drop policy if exists "admins read fleet_units"   on public.fleet_units;
drop policy if exists "admins write fleet_units"  on public.fleet_units;

create policy "admins read fleet_items"
  on public.fleet_items for select to authenticated using (public.is_admin());
create policy "admins write fleet_items"
  on public.fleet_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admins read fleet_units"
  on public.fleet_units for select to authenticated using (public.is_admin());
create policy "admins write fleet_units"
  on public.fleet_units for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The public intake page has no business here at all.
revoke all on public.fleet_items from anon;
revoke all on public.fleet_units from anon;

-- ---------------------------------------------------------
-- 4. Capacity from a model number
--
-- Heavy equipment model numbers encode size, but the rule is per
-- manufacturer, so this only fires on conventions that are actually
-- reliable. Everything else stays null rather than guessed:
--
--   Caterpillar excavators   349 -> 49 t, 336 -> 36 t, 320 -> 20 t
--                            (last two digits of a 3xx model)
--   Komatsu PC excavators    PC350 -> 35 t, PC200 -> 20 t
--                            (digits after PC, divided by 10)
--
-- The file's own "Intended Venezuela Use" column agrees: it calls the
-- 336 a "40 MT-class" machine and the 330 a "30 MT" machine.
--
-- Anything this produces is marked capacity_source = 'model' so an
-- estimate is never mistaken for a measurement.
-- ---------------------------------------------------------

create or replace function public.capacity_from_model(p_make text, p_model text)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  v_make  text := lower(coalesce(p_make, ''));
  v_model text := upper(coalesce(p_model, ''));
  v_num   text;
begin
  -- Caterpillar 3-series excavators: 320, 330, 336, 345, 349 …
  if v_make like '%caterpillar%' or v_make like '%cat%' then
    v_num := substring(v_model from '^\s*3(\d{2})');
    if v_num is not null then
      return v_num::numeric;
    end if;
  end if;

  -- Komatsu PC line: PC200 -> 20 t, PC350 -> 35 t
  if v_make like '%komatsu%' then
    v_num := substring(v_model from 'PC\s*(\d{3})');
    if v_num is not null then
      return round(v_num::numeric / 10.0, 1);
    end if;
  end if;

  return null;
end;
$fn$;

comment on function public.capacity_from_model(text, text) is
  'Best-effort tonnage from a model number, for the manufacturers whose numbering is reliable. Null when unknown.';

-- ---------------------------------------------------------
-- 5. Headline numbers for the fleet view
-- ---------------------------------------------------------

create or replace function public.own_fleet_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'types',      (select count(*) from public.fleet_items),
    'available',  (select coalesce(sum(qty_available), 0) from public.fleet_items),
    'required',   (select coalesce(sum(qty_required), 0)  from public.fleet_items),
    'shortfall',  (select coalesce(sum(greatest(qty_required - qty_available, 0)), 0)
                   from public.fleet_items),
    'units',      (select count(*) from public.fleet_units),
    'by_equipment', (select coalesce(jsonb_agg(jsonb_build_object(
                        'equipment', equipment, 'available', a, 'required', r) order by r desc, a desc), '[]'::jsonb)
                     from (select equipment,
                                  sum(qty_available)::int as a,
                                  sum(qty_required)::int  as r
                           from public.fleet_items group by 1) t)
  );
$fn$;

revoke all on function public.own_fleet_stats() from public;
revoke all on function public.own_fleet_stats() from anon;
grant execute on function public.own_fleet_stats() to authenticated;

-- ---------------------------------------------------------
-- 6. Loader, used by the dashboard's Import file button
-- ---------------------------------------------------------

create or replace function public.import_own_fleet(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_owner  text := coalesce(nullif(btrim(payload ->> 'owner'), ''), 'ANSAD');
  v_items  jsonb := coalesce(payload -> 'items', '[]'::jsonb);
  v_units  jsonb := coalesce(payload -> 'units', '[]'::jsonb);
  v_caller uuid := auth.uid();
  v_item   jsonb;
  v_id     uuid;
  v_ni     integer := 0;
  v_nu     integer := 0;
begin
  if v_caller is not null and not public.is_admin() then
    raise exception 'Not authorised to import.' using errcode = '42501';
  end if;

  -- Re-importing replaces this owner's fleet rather than duplicating it.
  delete from public.fleet_units where owner = v_owner;
  delete from public.fleet_items where owner = v_owner;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    insert into public.fleet_items (
      owner, ref, equipment, make, model,
      qty_available, qty_required, intended_use, notes,
      capacity_t, capacity_source
    ) values (
      v_owner,
      nullif(v_item ->> 'ref', ''),
      coalesce(nullif(v_item ->> 'equipment', ''), 'Unspecified'),
      nullif(v_item ->> 'make', ''),
      nullif(v_item ->> 'model', ''),
      coalesce(nullif(v_item ->> 'qtyAvailable', '')::integer, 0),
      coalesce(nullif(v_item ->> 'qtyRequired', '')::integer, 0),
      nullif(v_item ->> 'intendedUse', ''),
      nullif(v_item ->> 'notes', ''),
      coalesce(
        nullif(v_item ->> 'capacityT', '')::numeric,
        public.capacity_from_model(v_item ->> 'make', v_item ->> 'model')
      ),
      case
        when nullif(v_item ->> 'capacityT', '') is not null then 'stated'
        when public.capacity_from_model(v_item ->> 'make', v_item ->> 'model') is not null then 'model'
        else 'unknown'
      end
    )
    returning id into v_id;
    v_ni := v_ni + 1;

    -- Attach any units that name this item's ref.
    insert into public.fleet_units (
      item_id, owner, ref, unit_no, equipment, make, model,
      year, serial_vin, hours, capacity, engine, attachments,
      condition, location, service_notes, export_ready, lead_time, price, comments
    )
    select
      v_id, v_owner,
      nullif(u ->> 'ref', ''), nullif(u ->> 'unitNo', ''),
      nullif(u ->> 'equipment', ''), nullif(u ->> 'make', ''), nullif(u ->> 'model', ''),
      nullif(u ->> 'year', '')::integer,
      nullif(u ->> 'serial', ''), nullif(u ->> 'hours', ''), nullif(u ->> 'capacity', ''),
      nullif(u ->> 'engine', ''), nullif(u ->> 'attachments', ''),
      nullif(u ->> 'condition', ''), nullif(u ->> 'location', ''),
      nullif(u ->> 'service', ''), nullif(u ->> 'exportReady', ''),
      nullif(u ->> 'leadTime', ''), nullif(u ->> 'price', ''), nullif(u ->> 'comments', '')
    from jsonb_array_elements(v_units) as t(u)
    where nullif(u ->> 'itemRef', '') is not distinct from nullif(v_item ->> 'ref', '');

    get diagnostics v_nu = row_count;
  end loop;

  -- Units whose itemRef matched nothing still belong in the register.
  insert into public.fleet_units (
    owner, ref, unit_no, equipment, make, model, comments
  )
  select v_owner, nullif(u ->> 'ref', ''), nullif(u ->> 'unitNo', ''),
         nullif(u ->> 'equipment', ''), nullif(u ->> 'make', ''), nullif(u ->> 'model', ''),
         nullif(u ->> 'comments', '')
  from jsonb_array_elements(v_units) as t(u)
  where not exists (
    select 1 from public.fleet_items fi
    where fi.owner = v_owner
      and fi.ref is not distinct from nullif(u ->> 'itemRef', '')
  );

  select count(*) into v_nu from public.fleet_units where owner = v_owner;

  return jsonb_build_object('owner', v_owner, 'items', v_ni, 'units', v_nu);
end;
$fn$;

revoke all on function public.import_own_fleet(jsonb) from public;
revoke all on function public.import_own_fleet(jsonb) from anon;
grant execute on function public.import_own_fleet(jsonb) to authenticated;

-- ---------------------------------------------------------
-- 7. Count line items and machines separately
--
-- "1,280 machines listed" and "1,465 units" were both correct and looked
-- like a contradiction: the first counts rows in a supplier's list, the
-- second counts actual machines, and a row reading "Generator Set, qty 5"
-- is one row and five machines. The dashboard now gets both numbers by
-- name so it can say which is which.
-- ---------------------------------------------------------

create or replace function public.fleet_intake_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'companies',  (select count(*) from public.submissions),
    -- rows in the submitted lists
    'machines',   (select coalesce(sum(equipment_count), 0) from public.submissions),
    -- actual machines, respecting a row that stands for several units
    'units',      (select coalesce(sum(coalesce(qty, 1)), 0) from public.equipment),
    'awaiting',   (select count(*) from public.submissions where status = 'new'),
    'last7',      (select count(*) from public.submissions
                    where submitted_at >= now() - interval '7 days'),
    'prev7',      (select count(*) from public.submissions
                    where submitted_at >= now() - interval '14 days'
                      and submitted_at <  now() - interval '7 days'),
    'weekly',     (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'n', n) order by w), '[]'::jsonb)
                    from (
                      select date_trunc('week', submitted_at)::date as w, count(*) as n
                      from public.submissions
                      where submitted_at >= date_trunc('week', now()) - interval '11 weeks'
                      group by 1
                    ) t)
  );
$fn$;

revoke all on function public.fleet_intake_stats() from public;
revoke all on function public.fleet_intake_stats() from anon;
grant execute on function public.fleet_intake_stats() to authenticated;
