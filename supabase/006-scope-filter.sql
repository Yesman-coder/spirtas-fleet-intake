-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 006: only demolition and construction plant counts.
--
-- The La Guaira works need demolition and construction machinery.
-- Companies send their whole asset register, which includes
-- laboratory benches, pickups and office furniture. Those are
-- accepted without argument and then kept out of the fleet.
--
-- Three states, and nothing is ever discarded:
--   in      counted as fleet
--   out     stored, excluded from every fleet view and export
--   review  stored, waiting for a person to decide
--
-- Run AFTER schema.sql and 003. Safe to re-run.
-- =========================================================

alter table public.equipment
  add column if not exists scope text not null default 'review'
    check (scope in ('in', 'out', 'review'));

alter table public.equipment
  add column if not exists scope_reason text;

comment on column public.equipment.scope is
  'in = demolition/construction plant. out = something else. review = undecided. Only "in" counts as fleet.';
comment on column public.equipment.scope_reason is
  'Why it was classified that way, so a wrong call can be understood rather than guessed at.';

create index if not exists equipment_scope_idx on public.equipment (scope);

-- ---------------------------------------------------------
-- Where the decision is made
--
-- The classifier is assets/scope.js, shared by the intake form and the
-- dashboard so both agree, and it sends its verdict with the payload.
-- Keeping the keyword lists in one JavaScript file rather than mirroring
-- them in plpgsql means there is one place to edit when a new spelling
-- turns up.
--
-- That does mean a hand-crafted POST could claim scope 'in' for a desk.
-- It is a business filter, not a security boundary: the worst case is a
-- desk in the review queue, and an admin can change any row's scope from
-- the dashboard. Anything that arrives without a verdict defaults to
-- 'review' rather than being trusted.
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
    v_id, upper(left(v_id::text, 8)), v_language,
    left(v_name, 200), left(v_person, 200), left(v_email, 320), left(v_phone, 60),
    v_count
  );

  for v_item in select * from jsonb_array_elements(v_equipment)
  loop
    v_idx := v_idx + 1;
    insert into public.equipment (
      submission_id, row_index,
      brand, type, model, unit_id, capacity, age, location, price, contact,
      extras, scope, scope_reason
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
      case when jsonb_typeof(v_item -> 'extras') = 'object'
            and v_item -> 'extras' <> '{}'::jsonb
           then v_item -> 'extras' else null end,
      case when v_item ->> 'scope' in ('in', 'out', 'review')
           then v_item ->> 'scope' else 'review' end,
      left(nullif(btrim(v_item ->> 'scopeReason'), ''), 200)
    );
  end loop;

  return v_id;
end;
$fn$;

revoke all on function public.submit_fleet_intake(jsonb) from public;
grant execute on function public.submit_fleet_intake(jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- Counts now mean "fleet", not "everything submitted"
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
    'machines',   (select count(*) from public.equipment where scope = 'in'),
    'units',      (select coalesce(sum(coalesce(qty, 1)), 0)
                   from public.equipment where scope = 'in'),
    'excluded',   (select count(*) from public.equipment where scope = 'out'),
    'to_review',  (select count(*) from public.equipment where scope = 'review'),
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

-- ---------------------------------------------------------
-- Classifying what is already loaded
--
-- Rows imported before this migration all sit at the 'review' default.
-- The dashboard's Import file reclassifies on re-import; to sort the
-- existing ones without that, these two statements cover the clear cases
-- and leave the rest for a person:
--
--   update public.equipment set scope = 'out', scope_reason = 'Not construction plant'
--    where scope = 'review'
--      and (type ilike any (array['%pickup%','%laborator%','%office%','%desk%',
--                                 '%microscop%','%computer%','%furniture%','%light vehicle%'])
--        or machine_family ilike any (array['%Laboratory%','%Light Vehicle%']));
--
--   update public.equipment set scope = 'in', scope_reason = 'Construction plant'
--    where scope = 'review'
--      and type ilike any (array['%excavat%','%loader%','%dozer%','%crane%','%grua%',
--                                '%compact%','%roller%','%truck%','%camion%','%crusher%',
--                                '%mixer%','%generator%','%planta electrica%','%pump%','%bomba%']);
-- ---------------------------------------------------------
