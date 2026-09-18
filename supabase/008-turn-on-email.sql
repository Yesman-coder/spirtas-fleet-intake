-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Switch email notifications on.
--
-- Run 007-email-notifications.sql first (already done if
-- test_notification() exists).
--
-- Change ONE line below — the API key — then run the whole file.
-- It tells you what happened at each step.
-- =========================================================


-- ---------------------------------------------------------
-- STEP 1 — where do things stand right now?
-- ---------------------------------------------------------

select
  case when enabled then 'on' else 'OFF' end                     as switch,
  case when coalesce(btrim(resend_api_key), '') = '' then 'NOT SET'
       else 'set (' || left(resend_api_key, 6) || '…)' end       as api_key,
  coalesce(array_to_string(to_emails, ', '), '')                 as recipients,
  from_email
from public.notify_settings where id = 1;

-- Is the trigger actually attached to the submissions table?
select tgname as trigger_name,
       case when tgenabled = 'D' then 'DISABLED' else 'active' end as state
from pg_trigger
where tgrelid = 'public.submissions'::regclass
  and not tgisinternal;


-- ---------------------------------------------------------
-- STEP 2 — paste your Resend API key on the line marked below
--
-- Get one at https://resend.com → API Keys → Create API Key
-- ("Sending access" is enough). It starts with  re_
--
-- Add more addresses to the array to notify more people.
-- ---------------------------------------------------------

update public.notify_settings set
  resend_api_key = 're_PASTE_YOUR_KEY_HERE',          -- <<<<<< THE ONLY LINE YOU MUST CHANGE
  to_emails      = array['yesman.utrera@spirtasworldwide.com'],
  from_email     = 'onboarding@resend.dev',
  from_name      = 'Spirtas Fleet Intake',
  dashboard_url  = 'https://yesman-coder.github.io/spirtas-fleet-intake/admin.html',
  enabled        = true,
  updated_at     = now()
where id = 1;


-- ---------------------------------------------------------
-- STEP 3 — confirm it took
-- ---------------------------------------------------------

select
  case when enabled then 'on' else 'OFF' end                     as switch,
  case when coalesce(btrim(resend_api_key), '') = ''
            or resend_api_key like '%PASTE_YOUR_KEY%'
       then 'STILL NOT SET — go back to step 2'
       else 'set (' || left(resend_api_key, 6) || '…)' end       as api_key,
  array_to_string(to_emails, ', ')                               as recipients
from public.notify_settings where id = 1;


-- ---------------------------------------------------------
-- STEP 4 — send yourself a test
-- ---------------------------------------------------------

select public.test_notification();


-- ---------------------------------------------------------
-- STEP 5 — what Resend actually said
--
-- Run this a few seconds after step 4. pg_net sends in the
-- background, so the reply lands a moment later.
--
--   status_code 200  -> accepted; check your inbox (and spam)
--   status_code 401  -> the API key is wrong
--   status_code 403  -> the from_email domain is not verified at Resend
--   status_code 422  -> a recipient address is malformed
--   no rows at all   -> the request never went out; see the note below
-- ---------------------------------------------------------

select id, status_code, left(content, 300) as response
from net._http_response
order by id desc
limit 5;

-- If step 5 returns nothing, pg_net's background worker may not be running
-- on this project. Check that the extension is actually installed:
--
--   select extname, extversion from pg_extension where extname = 'pg_net';
--
-- If that comes back empty, run:  create extension pg_net with schema extensions;
-- and try step 4 again.
