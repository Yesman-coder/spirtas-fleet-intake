-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 004: let an admin bulk import from the dashboard.
--
-- The public form registers ONE company per submission, which is
-- right — a company is registering itself. But a consolidated
-- master file holds many companies, and pushing that through the
-- public form files every machine under a single name.
--
-- So multi-company import belongs on the admin side. This is the
-- same loader the SQL import files use, opened up to signed-in
-- admins so the dashboard can call it directly.
--
-- Run AFTER 002-master-import-schema.sql. Safe to re-run.
-- =========================================================

create or replace function public.import_master_company(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id     uuid := gen_random_uuid();
  v_items  jsonb := coalesce(payload -> 'equipment', '[]'::jsonb);
  v_name   text  := nullif(btrim(payload -> 'company' ->> 'name'), '');
  v_caller uuid  := auth.uid();
begin
  -- security definer means this runs with the owner's rights, so it has to
  -- do its own gate. A signed-in user who is not on the admin allowlist
  -- gets nothing. Called from the SQL editor auth.uid() is null, which is
  -- the postgres role running it directly — allowed.
  if v_caller is not null and not public.is_admin() then
    raise exception 'Not authorised to import.' using errcode = '42501';
  end if;

  if v_name is null then
    raise exception 'Every imported company needs a name.' using errcode = '22023';
  end if;

  if jsonb_array_length(v_items) > 20000 then
    raise exception 'That is more than 20000 machines for one company. Split the file.'
      using errcode = '22023';
  end if;

  -- Re-running an import replaces that company rather than duplicating it.
  delete from public.submissions
   where source = 'master' and company_name = v_name;

  insert into public.submissions (
    id, ref, source, language, company_name, contact_person, email, phone,
    equipment_count, status, locations, source_file, submitted_at
  ) values (
    v_id,
    upper(left(v_id::text, 8)),
    'master',
    coalesce(payload ->> 'language', 'es'),
    left(v_name, 200),
    coalesce(nullif(btrim(payload -> 'company' ->> 'contactPerson'), ''), '— not supplied —'),
    coalesce(nullif(btrim(payload -> 'company' ->> 'email'), ''), 'no-email@not-supplied.invalid'),
    coalesce(nullif(btrim(payload -> 'company' ->> 'phone'), ''), '— not supplied —'),
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
    machine_family, machine_family_es, condition, condition_es, year, qty, extras
  )
  select
    v_id,
    (ord)::integer,
    nullif(it ->> 'ref', ''),
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
    coalesce(nullif(it ->> 'qty', '')::integer, 1),
    case when jsonb_typeof(it -> 'extras') = 'object' and it -> 'extras' <> '{}'::jsonb
         then it -> 'extras' else null end
  from jsonb_array_elements(v_items) with ordinality as t(it, ord);

  return v_id;
end;
$fn$;

comment on function public.import_master_company(jsonb) is
  'Loads one company and its machines. Admin only. Replaces that company if it was already imported.';

revoke all on function public.import_master_company(jsonb) from public;
revoke all on function public.import_master_company(jsonb) from anon;
grant execute on function public.import_master_company(jsonb) to authenticated;

-- ---------------------------------------------------------
-- Undo an import
--
-- Removes everything loaded from a spreadsheet, leaving anything that
-- came through the public form untouched. Equipment goes with it.
--
--   delete from public.submissions where source = 'master';
--
-- Or drop the one company that went in wrong:
--
--   delete from public.submissions
--    where company_name = 'THE WRONG NAME';
-- ---------------------------------------------------------
