-- =========================================================
-- Run these ONE AT A TIME.
--
-- The Supabase SQL editor only shows the result of the last
-- statement, so running a whole file hides everything above it.
-- Highlight a block and press Run, or run one and delete it.
-- =========================================================


-- ===== QUERY 1 — the important one ========================
-- What Resend replied. status_code tells you everything.
--   200 -> accepted. It is a delivery/spam problem, not code.
--   401 -> the API key is wrong or revoked.
--   403 -> from_email is on a domain you have not verified at Resend.
--   422 -> a recipient address is malformed.
--   NULL status + empty content -> the request never completed.
--   no rows at all -> nothing was ever sent.

select id,
       status_code,
       left(content, 500) as resend_said,
       created
from net._http_response
order by id desc
limit 10;



-- ===== QUERY 2 — did the trigger itself run? ==============
-- Two rows should be here from the test registrations already sent.
-- Empty means the trigger is not attached to the table.

select sent_at, company_name, ok, detail
from public.notify_log
order by sent_at desc
limit 10;



-- ===== QUERY 3 — is the trigger attached? =================

select tgname as trigger_name,
       case tgenabled when 'D' then 'DISABLED' else 'active' end as state
from pg_trigger
where tgrelid = 'public.submissions'::regclass
  and not tgisinternal;



-- ===== QUERY 4 — what exactly is configured? ==============
-- Shows only the first 6 characters of the key, never the whole thing.

select enabled,
       case when coalesce(btrim(resend_api_key), '') = '' then 'NOT SET'
            when resend_api_key like '%PASTE%' or resend_api_key like '%XXXX%'
                 then 'STILL THE PLACEHOLDER'
            else 'set (' || left(resend_api_key, 6) || '...)' end as api_key,
       array_to_string(to_emails, ', ') as recipients,
       from_name || ' <' || from_email || '>' as sends_as
from public.notify_settings
where id = 1;



-- ===== QUERY 5 — anything stuck unsent? ===================

select count(*) as still_queued from net.http_request_queue;
