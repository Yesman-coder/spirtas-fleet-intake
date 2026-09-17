-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Finish setup: apply the last fix, drop the test row, and
-- report whether everything is ready. Safe to re-run.
--
-- Run the whole file at once in the Supabase SQL Editor.
-- =========================================================

revoke all on function public.fleet_intake_stats() from anon;

delete from public.submissions where company_name = 'ZZ TEST - delete me';

-- ---------------------------------------------------------
-- Report
-- ---------------------------------------------------------
select 'anon locked out of stats' as check,
       case when has_function_privilege('anon', 'public.fleet_intake_stats()', 'execute')
            then 'STILL OPEN' else 'OK' end as result,
       '' as detail
union all
select 'test row removed',
       case when exists (select 1 from public.submissions
                         where company_name = 'ZZ TEST - delete me')
            then 'STILL THERE' else 'OK' end,
       ''
union all
select 'login accounts created',
       case when (select count(*) from auth.users) > 0 then 'OK' else 'NONE - create one in Authentication > Users' end,
       coalesce((select string_agg(email, ', ') from auth.users), 'none')
union all
select 'admins on the allowlist',
       case when (select count(*) from public.admins) > 0 then 'OK' else 'NONE - see step 2 below' end,
       coalesce((select string_agg(email, ', ') from public.admins), 'none')
union all
select 'real registrations',
       'FYI',
       (select count(*)::text from public.submissions);

-- ---------------------------------------------------------
-- If "admins on the allowlist" says NONE, put your email in the
-- line below and run just this block.
-- ---------------------------------------------------------
-- with target as (select 'you@yourdomain.com'::text as email)
-- insert into public.admins (user_id, email)
-- select u.id, u.email from auth.users u, target t
-- where lower(u.email) = lower(t.email)
-- on conflict (user_id) do nothing
-- returning email as added_admin;
