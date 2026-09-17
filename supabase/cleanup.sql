-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- One-time tidy-up after the first end-to-end test.
-- Run this once in the Supabase SQL Editor, then you can
-- delete this file.
-- =========================================================

-- 1. Close the stats function to the anonymous role.
--    Supabase's default privileges grant EXECUTE on new functions to anon,
--    and revoking from PUBLIC does not remove that separate grant. Nothing
--    was exposed (row-level security returned zeroes), but the dashboard's
--    numbers should not be reachable from the public page at all.
revoke all on function public.fleet_intake_stats() from anon;

-- 2. Remove the test registration written while verifying the connection.
--    The equipment rows go with it automatically (cascading delete).
delete from public.submissions where company_name = 'ZZ TEST - delete me';

-- 3. Confirm the result: both numbers should come back 0.
select
  (select count(*) from public.submissions
     where company_name = 'ZZ TEST - delete me')                    as test_rows_left,
  (select case when has_function_privilege('anon',
            'public.fleet_intake_stats()', 'execute')
          then 1 else 0 end)                                        as anon_can_read_stats;
