-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 002: room for the consolidated master data.
--
-- The web form collects nine fields per machine. The master
-- spreadsheets carry more — a machine family, a year, a quantity,
-- a condition, a source reference — and they carry the text fields
-- twice, once in English and once in Spanish. Filtering is the whole
-- point of this data, so those get real columns rather than being
-- flattened away.
--
-- Run this AFTER schema.sql. Safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Where a registration came from
-- ---------------------------------------------------------

alter table public.submissions
  add column if not exists source text not null default 'web'
    check (source in ('web', 'master'));

comment on column public.submissions.source is
  'web = submitted through the public form. master = loaded from a consolidated spreadsheet.';

-- The master lists locations per machine, not one address per company,
-- and names the PDF/XLSX each company''s data came from.
alter table public.submissions add column if not exists locations   text;
alter table public.submissions add column if not exists source_file text;

-- ---------------------------------------------------------
-- 2. The extra machine fields
--
-- Spanish columns sit beside the English ones rather than in a second
-- table: a machine is one row in both languages, and a search should
-- find it whichever language the admin types.
-- ---------------------------------------------------------

alter table public.equipment add column if not exists source_ref        text;
alter table public.equipment add column if not exists machine_family    text;
alter table public.equipment add column if not exists machine_family_es text;
alter table public.equipment add column if not exists type_es           text;
alter table public.equipment add column if not exists location_es       text;
alter table public.equipment add column if not exists condition         text;
alter table public.equipment add column if not exists condition_es      text;
alter table public.equipment add column if not exists year              integer;
alter table public.equipment add column if not exists qty               integer not null default 1;

comment on column public.equipment.machine_family is
  'Coarse grouping from the master spreadsheet, e.g. "Excavators (incl. jumbos)". Null for web submissions.';
comment on column public.equipment.qty is
  'How many identical units this row stands for. 1 for anything typed into the web form.';

-- ---------------------------------------------------------
-- 3. Indexes
--
-- The dashboard loads the whole equipment set once and filters it in the
-- browser, which is the right trade at this size (about 1,100 rows, well
-- under a megabyte) and makes every filter instant with no round trip.
-- These indexes are for the exports and any direct SQL you run.
-- If this table ever passes roughly 20,000 rows, move filtering back to
-- the server before the initial load starts to drag.
-- ---------------------------------------------------------

create index if not exists equipment_brand_idx    on public.equipment (brand);
create index if not exists equipment_family_idx   on public.equipment (machine_family);
create index if not exists equipment_year_idx     on public.equipment (year);
create index if not exists submissions_source_idx on public.submissions (source);

-- ---------------------------------------------------------
-- 4. Load a whole company and its machines in one call
--
-- Used by the import script. security definer so it can write, but
-- EXECUTE is granted to nobody by default — the import runs as the
-- postgres role in the SQL editor. The public anon key cannot reach it.
-- ---------------------------------------------------------

create or replace function public.import_master_company(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id    uuid := gen_random_uuid();
  v_items jsonb := coalesce(payload -> 'equipment', '[]'::jsonb);
begin
  -- Re-running the import replaces a company rather than duplicating it.
  delete from public.submissions
   where source = 'master'
     and company_name = payload -> 'company' ->> 'name';

  insert into public.submissions (
    id, ref, source, language, company_name, contact_person, email, phone,
    equipment_count, status, locations, source_file, submitted_at
  ) values (
    v_id,
    upper(left(v_id::text, 8)),
    'master',
    coalesce(payload ->> 'language', 'es'),
    payload -> 'company' ->> 'name',
    coalesce(nullif(payload -> 'company' ->> 'contactPerson', ''), '— not supplied —'),
    coalesce(nullif(payload -> 'company' ->> 'email', ''), 'no-email@not-supplied.invalid'),
    coalesce(nullif(payload -> 'company' ->> 'phone', ''), '— not supplied —'),
    jsonb_array_length(v_items),
    'reviewed',
    payload -> 'company' ->> 'locations',
    payload -> 'company' ->> 'sourceFile',
    coalesce((payload ->> 'submittedAt')::timestamptz, now())
  );

  insert into public.equipment (
    submission_id, row_index, source_ref,
    brand, type, type_es, model, unit_id, capacity, age,
    location, location_es, price, contact,
    machine_family, machine_family_es, condition, condition_es, year, qty
  )
  select
    v_id,
    (ord)::integer,
    it ->> 'ref',
    nullif(it ->> 'brand', ''),
    nullif(it ->> 'type', ''),
    nullif(it ->> 'typeEs', ''),
    nullif(it ->> 'model', ''),
    nullif(it ->> 'unitId', ''),
    nullif(it ->> 'capacity', ''),
    nullif(it ->> 'age', ''),
    nullif(it ->> 'location', ''),
    nullif(it ->> 'locationEs', ''),
    nullif(it ->> 'price', ''),
    nullif(it ->> 'contact', ''),
    nullif(it ->> 'family', ''),
    nullif(it ->> 'familyEs', ''),
    nullif(it ->> 'condition', ''),
    nullif(it ->> 'conditionEs', ''),
    nullif(it ->> 'year', '')::integer,
    coalesce(nullif(it ->> 'qty', '')::integer, 1)
  from jsonb_array_elements(v_items) with ordinality as t(it, ord);

  return v_id;
end;
$fn$;

comment on function public.import_master_company(jsonb) is
  'Loads one company and its machines from the consolidated master. Replaces that company if it was already imported.';

revoke all on function public.import_master_company(jsonb) from public;
revoke all on function public.import_master_company(jsonb) from anon;
revoke all on function public.import_master_company(jsonb) from authenticated;
