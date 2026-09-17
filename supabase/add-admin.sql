-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Grant someone access to the admin dashboard.
--
-- BEFORE running this, the person must already have a Supabase Auth
-- account: dashboard -> Authentication -> Users -> "Add user" ->
-- "Create new user", enter their email and a password, and tick
-- "Auto Confirm User". This script only adds an existing account to
-- the allowlist; it cannot create the login itself.
-- =========================================================

-- ---------------------------------------------------------
-- STEP 1 — see which accounts exist and who is already an admin.
-- ---------------------------------------------------------

select u.email,
       u.created_at,
       (u.email_confirmed_at is not null) as confirmed,
       (a.user_id is not null)            as is_admin
from auth.users u
left join public.admins a on a.user_id = u.id
order by u.created_at desc;

-- ---------------------------------------------------------
-- STEP 2 — put the email below, then run this block on its own.
-- It reports what it did instead of failing silently.
-- ---------------------------------------------------------

with target as (
  select 'you@spirtasworldwide.com'::text as email      -- <<< CHANGE THIS
),
added as (
  insert into public.admins (user_id, email)
  select u.id, u.email
  from auth.users u, target t
  where lower(u.email) = lower(t.email)
  on conflict (user_id) do nothing
  returning email
)
select case
  when exists (select 1 from added)
    then 'Added ' || (select email from added) || ' as an admin. They can sign in now.'
  when not exists (select 1 from auth.users u, target t where lower(u.email) = lower(t.email))
    then 'No account with that email. Create it first: Authentication -> Users -> Add user.'
  else 'That account was already an admin. Nothing to change.'
end as result;

-- ---------------------------------------------------------
-- To revoke someone's access, delete their allowlist row. Their login
-- still exists but the dashboard will show them nothing and sign them
-- back out:
--
--   delete from public.admins
--   where lower(email) = lower('someone@spirtasworldwide.com');
-- ---------------------------------------------------------
