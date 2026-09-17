-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 003: keep the columns we did not ask for.
--
-- Companies send the list they already keep, with whatever columns
-- their own system uses — SERIAL, ESTATUS, OBSERVACIONES, PLACA,
-- CATEGORIA. The intake form maps what it recognises onto our nine
-- fields; everything else used to be dropped on the floor.
--
-- Now it is kept per machine in `extras`, so a column nobody
-- anticipated is still there when you go to clean the data up.
-- Nothing has to be right at submission time.
--
-- Run this AFTER schema.sql. Safe to re-run.
-- =========================================================

alter table public.equipment
  add column if not exists extras jsonb;

comment on column public.equipment.extras is
  'Columns from the submitted file that did not map to a known field, as {"COLUMN NAME": "value"}. Never discarded, so it can be cleaned up later.';

-- Lets you find a machine by a value in a column we do not model.
create index if not exists equipment_extras_idx on public.equipment using gin (extras);

-- ---------------------------------------------------------
-- Teach the public endpoint to store them.
--
-- This is the same function as in schema.sql with the extras column
-- added. Re-running schema.sql afterwards would undo this, so apply
-- 003 last, or copy this body back into schema.sql.
-- ---------------------------------------------------------

create or replace function public.submit_fleet_intake(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_company    jsonb := coalesce(payload -> 'company', '{}'::jsonb);
  v_equipment  jsonb := coalesce(payload -> 'equipment', '[]'::jsonb);
  v_name       text  := nullif(btrim(v_company ->> 'name'), '');
  v_person     text  := nullif(btrim(v_company ->> 'contactPerson'), '');
  v_email      text  := nullif(btrim(v_company ->> 'email'), '');
  v_phone      text  := nullif(btrim(v_company ->> 'phone'), '');
  v_language   text  := lower(coalesce(payload ->> 'language', 'en'));
  v_count      integer;
  v_id         uuid;
  v_item       jsonb;
  v_idx        integer := 0;
begin
  if v_name is null or v_person is null or v_email is null or v_phone is null then
    raise exception 'Company name, contact person, email and phone are all required.'
      using errcode = '22023';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'That email address does not look valid.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_equipment) <> 'array' then
    raise exception 'Equipment must be a list.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(v_equipment);

  if v_count = 0 then
    raise exception 'Add at least one machine before submitting.' using errcode = '22023';
  end if;

  if v_count > 5000 then
    raise exception 'That list is too long. Please split it into batches of 5000 machines or fewer.'
      using errcode = '22023';
  end if;

  if v_language not in ('en', 'es') then
    v_language := 'en';
  end if;

  -- A connection that drops after the write succeeded looks exactly like a
  -- failure in the browser, so the company presses submit again. Hand back
  -- the row they already created instead of storing it twice.
  select s.id into v_id
  from public.submissions s
  where lower(s.email) = lower(v_email)
    and s.company_name = left(v_name, 200)
    and s.equipment_count = v_count
    and s.submitted_at >= now() - interval '2 minutes'
  order by s.submitted_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_id := gen_random_uuid();

  insert into public.submissions (
    id, ref, language, company_name, contact_person, email, phone, equipment_count
  ) values (
    v_id,
    upper(left(v_id::text, 8)),
    v_language,
    left(v_name,   200),
    left(v_person, 200),
    left(v_email,  320),
    left(v_phone,   60),
    v_count
  );

  for v_item in select * from jsonb_array_elements(v_equipment)
  loop
    v_idx := v_idx + 1;
    insert into public.equipment (
      submission_id, row_index,
      brand, type, model, unit_id, capacity, age, location, price, contact, extras
    ) values (
      v_id, v_idx,
      left(btrim(v_item ->> 'brand'),    120),
      left(btrim(v_item ->> 'type'),     120),
      left(btrim(v_item ->> 'model'),    120),
      left(btrim(v_item ->> 'unitId'),   120),
      left(btrim(v_item ->> 'capacity'), 120),
      left(btrim(v_item ->> 'age'),       60),
      left(btrim(v_item ->> 'location'), 200),
      left(btrim(v_item ->> 'price'),    120),
      left(btrim(v_item ->> 'contact'),  200),
      case
        when jsonb_typeof(v_item -> 'extras') = 'object'
         and v_item -> 'extras' <> '{}'::jsonb
        then v_item -> 'extras'
        else null
      end
    );
  end loop;

  return v_id;
end;
$fn$;

revoke all on function public.submit_fleet_intake(jsonb) from public;
grant execute on function public.submit_fleet_intake(jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- Cleaning up later
--
-- See which unmapped columns are turning up and how often. If a column
-- keeps appearing, add its spelling to HEADER_ALIASES in assets/i18n.js
-- so the next submission maps it automatically:
--
--   select k as column_name, count(*) as rows
--   from public.equipment e, lateral jsonb_object_keys(e.extras) k
--   where e.extras is not null
--   group by 1 order by 2 desc;
--
-- Promote one into a real field once you know what it is, e.g. a serial
-- number that arrived under a column we did not map:
--
--   update public.equipment
--      set unit_id = extras ->> 'SERIAL'
--    where unit_id is null
--      and extras ? 'SERIAL';
-- ---------------------------------------------------------
