-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Post-install check. Run this in the Supabase SQL Editor after
-- schema.sql. Every row should say OK. Safe to re-run any time.
-- =========================================================

with checks as (

  select 1 as ord, 'tables' as item,
         count(*)::text || ' of 3' as found,
         case when count(*) = 3 then 'OK' else 'MISSING' end as result
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('submissions', 'equipment', 'admins')

  union all
  select 2, 'row-level security enabled',
         count(*)::text || ' of 3',
         case when count(*) = 3 then 'OK' else 'NOT ENABLED' end
  from pg_tables
  where schemaname = 'public'
    and tablename in ('submissions', 'equipment', 'admins')
    and rowsecurity

  union all
  select 3, 'policies',
         count(*)::text || ' of 5',
         case when count(*) = 5 then 'OK' else 'MISSING' end
  from pg_policies
  where schemaname = 'public'
    and tablename in ('submissions', 'equipment', 'admins')

  union all
  select 4, 'functions',
         count(*)::text || ' of 3',
         case when count(*) = 3 then 'OK' else 'MISSING' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('submit_fleet_intake', 'fleet_intake_stats', 'is_admin')

  union all
  -- The public page can only work if the anon role may call this one function.
  select 5, 'anon can call submit_fleet_intake',
         case when has_function_privilege('anon', 'public.submit_fleet_intake(jsonb)', 'execute')
              then 'granted' else 'denied' end,
         case when has_function_privilege('anon', 'public.submit_fleet_intake(jsonb)', 'execute')
              then 'OK' else 'NOT GRANTED' end

  union all
  -- ...and it must NOT be able to read submissions directly.
  select 6, 'anon blocked from reading submissions',
         case when (select count(*) from pg_policies
                    where schemaname = 'public'
                      and tablename = 'submissions'
                      and 'anon' = any(roles)) = 0
              then 'no anon policy' else 'ANON POLICY EXISTS' end,
         case when (select count(*) from pg_policies
                    where schemaname = 'public'
                      and tablename = 'submissions'
                      and 'anon' = any(roles)) = 0
              then 'OK' else 'REVIEW THIS' end

  union all
  select 7, 'admins on the allowlist',
         count(*)::text,
         case when count(*) > 0 then 'OK'
              else 'NONE YET - run the insert in step 4' end
  from public.admins

  union all
  select 8, 'registrations so far',
         count(*)::text, 'FYI'
  from public.submissions
)
select item, found, result from checks order by ord;
