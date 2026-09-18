-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Why is no email arriving?
--
-- Run this whole file. It checks every link in the chain and
-- says which one is broken, in plain words. Nothing is changed.
-- Paste the output back if it is not obvious.
-- =========================================================

-- ---------------------------------------------------------
-- The whole chain, one row per link
-- ---------------------------------------------------------

with
ext as (
  select count(*) as n, coalesce(max(extversion), '') as ver
  from pg_extension where extname = 'pg_net'
),
fn as (
  select count(*) as n from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where p.proname = 'http_post' and ns.nspname = 'net'
),
trg as (
  select count(*) as n
  from pg_trigger
  where tgrelid = 'public.submissions'::regclass
    and tgname = 'trg_notify_new_submission'
    and not tgisinternal
),
cfg as (
  select
    coalesce(max(case when enabled then 1 else 0 end), -1) as on_off,
    coalesce(max(case when coalesce(btrim(resend_api_key), '') = ''
                       or resend_api_key like '%PASTE%'
                       or resend_api_key like '%XXXX%'
                      then 0 else 1 end), -1)             as has_key,
    coalesce(max(coalesce(array_length(to_emails, 1), 0)), -1) as n_to,
    coalesce(max(from_email), '')                          as frm,
    coalesce(max(left(resend_api_key, 6)), '')             as key_head
  from public.notify_settings where id = 1
),
logs as (
  select count(*) as n,
         count(*) filter (where ok) as ok_n,
         coalesce(max(case when not ok then detail end), '') as last_err
  from public.notify_log where sent_at > now() - interval '2 days'
),
subs as (
  select count(*) as n from public.submissions
  where source = 'web' and submitted_at > now() - interval '2 days'
)
select * from (
  select 1 as step, 'pg_net extension installed' as link,
         case when (select n from ext) > 0
              then 'YES (v' || (select ver from ext) || ')'
              else 'NO  <-- run: create extension pg_net with schema extensions;' end as result
  union all
  select 2, 'net.http_post() exists',
         case when (select n from fn) > 0 then 'YES'
              else 'NO  <-- pg_net installed but its functions are missing; reinstall it' end
  union all
  select 3, 'trigger attached to submissions',
         case when (select n from trg) > 0 then 'YES'
              else 'NO  <-- re-run 007-email-notifications.sql' end
  union all
  select 4, 'notifications switched on',
         case (select on_off from cfg) when 1 then 'YES' when 0 then 'NO  <-- enabled = false'
              else 'NO SETTINGS ROW  <-- re-run 007' end
  union all
  select 5, 'Resend API key set',
         case (select has_key from cfg) when 1 then 'YES (' || (select key_head from cfg) || '...)'
              else 'NO  <-- still the placeholder. Run 008-turn-on-email.sql with a real key' end
  union all
  select 6, 'recipients set',
         case when (select n_to from cfg) > 0 then (select n_to from cfg)::text || ' address(es)'
              else 'NONE  <-- to_emails is empty' end
  union all
  select 7, 'from_email',
         (select frm from cfg)
  union all
  select 8, 'web submissions in the last 2 days',
         (select n from subs)::text
  union all
  select 9, 'trigger ran (notify_log entries, 2 days)',
         case when (select n from logs) = 0
              then '0  <-- the trigger never ran, or errored before logging'
              else (select n from logs)::text || ' (' || (select ok_n from logs)::text || ' queued ok)' end
  union all
  select 10, 'last trigger error',
         case when (select last_err from logs) = '' then '(none)' else (select last_err from logs) end
) x order by step;


-- ---------------------------------------------------------
-- What Resend actually replied to the last few requests
-- No rows here means the request never left the database.
-- ---------------------------------------------------------

select id, status_code, left(content, 400) as response, created
from net._http_response
order by id desc
limit 5;


-- ---------------------------------------------------------
-- Anything still sitting in the send queue
-- Rows piling up here mean pg_net's background worker is not running.
-- ---------------------------------------------------------

select count(*) as queued_and_unsent from net.http_request_queue;


-- ---------------------------------------------------------
-- A direct send, bypassing the trigger entirely.
--
-- This proves whether the database can reach Resend at all with
-- the key you saved. Run it, wait five seconds, then re-run the
-- net._http_response query above.
-- ---------------------------------------------------------

select net.http_post(
  url     := 'https://api.resend.com/emails',
  headers := jsonb_build_object(
               'Authorization', 'Bearer ' || (select resend_api_key from public.notify_settings where id = 1),
               'Content-Type',  'application/json'),
  body    := jsonb_build_object(
               'from',    (select from_name || ' <' || from_email || '>' from public.notify_settings where id = 1),
               'to',      (select to_jsonb(to_emails) from public.notify_settings where id = 1),
               'subject', 'Fleet Intake - direct test',
               'html',    '<p>Direct send from Postgres, bypassing the trigger.</p>')
) as request_id;
