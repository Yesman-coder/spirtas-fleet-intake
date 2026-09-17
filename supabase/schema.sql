-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Supabase schema: tables, row-level security, and the
-- single RPC the public form calls to save a submission.
--
-- Run this once in the Supabase SQL Editor (it is safe to
-- re-run: every statement is idempotent).
-- =========================================================

-- ---------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------

create table if not exists public.submissions (
  id              uuid primary key default gen_random_uuid(),
  submitted_at    timestamptz not null default now(),
  language        text        not null default 'en' check (language in ('en', 'es')),
  company_name    text        not null,
  contact_person  text        not null,
  email           text        not null,
  phone           text        not null,
  equipment_count integer     not null default 0,
  status          text        not null default 'new' check (status in ('new', 'reviewed', 'archived')),
  notes           text
);

comment on table public.submissions is
  'One row per company registration submitted through the public intake form.';

-- Short human-quotable reference: the first eight characters of the row's
-- own id, uppercased. This is the code shown on the confirmation screen and
-- the thing an admin types into the dashboard search box. Written by
-- submit_fleet_intake() below, which picks the id before it inserts, so the
-- reference and the id can never disagree.
alter table public.submissions
  add column if not exists ref text;

create table if not exists public.equipment (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  row_index     integer not null,
  brand         text,
  type          text,
  model         text,
  unit_id       text,
  capacity      text,
  age           text,
  location      text,
  price         text,
  contact       text
);

comment on table public.equipment is
  'One row per machine listed on a submission. Deleted automatically with its parent submission.';

-- Admin allowlist. A Supabase Auth account can read the data only if its
-- user id appears here, so an accidentally-open signup page still leaks
-- nothing. Rows are added by you from the SQL editor (see step 4 below).
create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);

comment on table public.admins is
  'Allowlist of auth users permitted to read submissions. Managed manually via SQL.';

create index if not exists submissions_submitted_at_idx on public.submissions (submitted_at desc);
create index if not exists submissions_status_idx       on public.submissions (status);
create index if not exists submissions_ref_idx          on public.submissions (ref);
create index if not exists equipment_submission_id_idx  on public.equipment (submission_id, row_index);

-- ---------------------------------------------------------
-- 2. Row-level security
--
-- Row-level security is on for all three tables and there is no policy for
-- the anon role, so the anonymous key used by the public page can read and
-- write exactly nothing directly, whatever table grants Supabase hands it.
-- Its only route in is submit_fleet_intake() below, which runs as the
-- definer and validates before it writes.
-- ---------------------------------------------------------

alter table public.submissions enable row level security;
alter table public.equipment   enable row level security;
alter table public.admins      enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$fn$;

comment on function public.is_admin() is
  'True when the calling auth user is on the admin allowlist.';

drop policy if exists "admins read submissions"   on public.submissions;
drop policy if exists "admins update submissions" on public.submissions;
drop policy if exists "admins delete submissions" on public.submissions;
drop policy if exists "admins read equipment"     on public.equipment;
drop policy if exists "admins read admins"        on public.admins;

create policy "admins read submissions"
  on public.submissions for select to authenticated using (public.is_admin());

-- Lets the dashboard change status and notes. The check clause repeats the
-- condition so an admin cannot write a row they could not also read.
create policy "admins update submissions"
  on public.submissions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admins delete submissions"
  on public.submissions for delete to authenticated using (public.is_admin());

create policy "admins read equipment"
  on public.equipment for select to authenticated using (public.is_admin());

create policy "admins read admins"
  on public.admins for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------
-- 3. The public submission endpoint
--
-- security definer: the anon role has no rights on the tables, so all
-- writes funnel through this one function, which validates before it
-- inserts. Company and equipment rows land in a single transaction —
-- a failure part-way through leaves nothing behind.
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

  -- Upper bound so a malformed or hostile payload cannot write unbounded rows.
  if v_count > 5000 then
    raise exception 'That list is too long. Please split it into batches of 5000 machines or fewer.'
      using errcode = '22023';
  end if;

  if v_language not in ('en', 'es') then
    v_language := 'en';
  end if;

  -- A connection that drops after the write succeeded looks exactly like a
  -- failure in the browser, so the company presses submit again. Hand back
  -- the row they already created instead of storing it twice. Matching on
  -- company, email and machine count inside a two-minute window is tight
  -- enough that a genuinely different submission still gets its own row.
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

  -- Pick the id up front so the row can carry its own short reference.
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
      brand, type, model, unit_id, capacity, age, location, price, contact
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
      left(btrim(v_item ->> 'contact'),  200)
    );
  end loop;

  return v_id;
end;
$fn$;

comment on function public.submit_fleet_intake(jsonb) is
  'Public intake endpoint. Validates a submission payload and writes the company plus its equipment rows atomically.';

-- Only the two API roles may call it; nothing else in the database can.
revoke all on function public.submit_fleet_intake(jsonb) from public;
grant execute on function public.submit_fleet_intake(jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 3b. Dashboard headline numbers
--
-- security INVOKER (the default, stated here for emphasis): this runs as
-- the caller, so row-level security still applies and a non-admin gets
-- zeroes rather than a leak. Counting in the database keeps the numbers
-- exact no matter how many rows exist — the dashboard never has to
-- download every row to add them up.
-- ---------------------------------------------------------

create or replace function public.fleet_intake_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'companies',   (select count(*) from public.submissions),
    'machines',    (select coalesce(sum(equipment_count), 0) from public.submissions),
    'awaiting',    (select count(*) from public.submissions where status = 'new'),
    'last7',       (select count(*) from public.submissions
                     where submitted_at >= now() - interval '7 days'),
    'prev7',       (select count(*) from public.submissions
                     where submitted_at >= now() - interval '14 days'
                       and submitted_at <  now() - interval '7 days'),
    'weekly',      (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'n', n) order by w), '[]'::jsonb)
                     from (
                       select date_trunc('week', submitted_at)::date as w, count(*) as n
                       from public.submissions
                       where submitted_at >= date_trunc('week', now()) - interval '11 weeks'
                       group by 1
                     ) t)
  );
$fn$;

comment on function public.fleet_intake_stats() is
  'Headline counts for the admin dashboard. Respects row-level security.';

revoke all on function public.fleet_intake_stats() from public;
grant execute on function public.fleet_intake_stats() to authenticated;

-- ---------------------------------------------------------
-- 4. Make yourself an admin
--
-- First create the account: Supabase dashboard -> Authentication -> Users
-- -> "Add user" -> enter your email and a password, and tick
-- "Auto Confirm User". Then run this with that same email:
--
--   insert into public.admins (user_id, email)
--   select id, email from auth.users where email = 'you@spirtasworldwide.com'
--   on conflict (user_id) do nothing;
--
-- Repeat for each teammate who should see the dashboard. To revoke
-- someone, delete their row from public.admins.
-- ---------------------------------------------------------
