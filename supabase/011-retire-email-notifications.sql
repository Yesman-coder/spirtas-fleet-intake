-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 011: retire email notifications.
--
-- Notifications by email are not being used. The Activity
-- view in the admin dashboard does the job instead: every
-- registration in arrival order, grouped by day, with
-- anything that landed since your last visit marked.
--
-- This removes the whole email chain added in 007. It is
-- safe to run whether or not 007 was ever applied, and safe
-- to re-run.
--
-- Read this before running: it drops notify_settings, which
-- is where the Resend API key was stored. That is deliberate.
-- The key has no other use here, and a live credential
-- sitting in a table nobody reads is worth removing rather
-- than leaving behind. Rotate or delete it at
-- resend.com/api-keys as well, since a key is only really
-- gone once the provider says so.
-- =========================================================


-- ---------------------------------------------------------
-- 1. What is about to be removed
--
-- Run the file top to bottom. This first query is here so the
-- teardown is not a leap in the dark.
-- ---------------------------------------------------------

select 'trigger'  as object, count(*)::text as found
from pg_trigger
where tgrelid = 'public.submissions'::regclass
  and tgname = 'trg_notify_new_submission'
  and not tgisinternal
union all
select 'functions', count(*)::text
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname in ('notify_new_submission', 'test_notification')
union all
select 'settings row', count(*)::text
from information_schema.tables
where table_schema = 'public' and table_name = 'notify_settings'
union all
select 'log rows kept', coalesce(
  (select count(*)::text from public.notify_log), '(no table)');


-- ---------------------------------------------------------
-- 2. Stop new registrations firing an email
--
-- The trigger goes first. Everything after this point is
-- cleanup, so if you stop reading here, nothing sends.
-- ---------------------------------------------------------

drop trigger if exists trg_notify_new_submission on public.submissions;


-- ---------------------------------------------------------
-- 3. Remove the notifier and its manual test
-- ---------------------------------------------------------

drop function if exists public.notify_new_submission();
drop function if exists public.test_notification();


-- ---------------------------------------------------------
-- 4. Remove the tables, and with them the stored API key
-- ---------------------------------------------------------

drop table if exists public.notify_log;
drop table if exists public.notify_settings;


-- ---------------------------------------------------------
-- 5. Confirm it is gone
--
-- Every row should read 0.
-- ---------------------------------------------------------

select 'trigger'   as object, count(*) as remaining
from pg_trigger
where tgrelid = 'public.submissions'::regclass
  and tgname = 'trg_notify_new_submission'
  and not tgisinternal
union all
select 'functions', count(*)
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname in ('notify_new_submission', 'test_notification')
union all
select 'tables', count(*)
from information_schema.tables
where table_schema = 'public'
  and table_name in ('notify_settings', 'notify_log');


-- ---------------------------------------------------------
-- A note on pg_net
--
-- The pg_net extension is left installed. Nothing calls it
-- once the trigger above is gone, it costs nothing idle, and
-- dropping an extension another migration might later want is
-- the more disruptive choice. To remove it anyway:
--
--   drop extension if exists pg_net;
--
-- Any replies still sitting in net._http_response are that
-- extension's own bookkeeping and disappear with it.
-- ---------------------------------------------------------
