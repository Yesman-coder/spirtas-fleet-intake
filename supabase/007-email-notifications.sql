-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 007: email when a company registers.
--
-- The Google Sheets version could email on each submission.
-- That was lost when the backend moved to Supabase and never
-- rebuilt, so until now the only way to learn about a new
-- registration was opening the dashboard.
--
-- This sends straight from Postgres via pg_net, so there is no
-- Edge Function to deploy and nothing to install locally. The
-- send is queued asynchronously: it never holds up a submission,
-- and a failure to send can never lose one.
--
-- Run AFTER schema.sql. Safe to re-run. Nothing sends until you
-- fill in the settings at the bottom.
-- =========================================================

-- pg_net posts HTTP requests from inside Postgres, asynchronously.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------
-- 1. Where the settings live
--
-- Row-level security is on and there are NO policies, deliberately: the
-- API key is then unreachable through the REST API by anon and by signed-in
-- admins alike. Only the security-definer function below can read it, and
-- you edit it from the SQL editor.
-- ---------------------------------------------------------

create table if not exists public.notify_settings (
  id             integer primary key default 1 check (id = 1),
  enabled        boolean not null default true,
  resend_api_key text,
  from_email     text not null default 'onboarding@resend.dev',
  from_name      text not null default 'Spirtas Fleet Intake',
  to_emails      text[] not null default '{}',
  dashboard_url  text not null default 'https://yesman-coder.github.io/spirtas-fleet-intake/admin.html',
  updated_at     timestamptz not null default now()
);

comment on table public.notify_settings is
  'One row. Holds the Resend key and recipients. No RLS policies on purpose, so the key is unreachable over the API.';

alter table public.notify_settings enable row level security;
revoke all on public.notify_settings from anon, authenticated;

insert into public.notify_settings (id) values (1) on conflict (id) do nothing;

-- A record of what was sent, so "did it fire?" has an answer that is not a
-- guess. Also RLS-on-no-policies; read it from the SQL editor.
create table if not exists public.notify_log (
  id            bigserial primary key,
  submission_id uuid,
  company_name  text,
  sent_at       timestamptz not null default now(),
  ok            boolean not null,
  detail        text
);

alter table public.notify_log enable row level security;
revoke all on public.notify_log from anon, authenticated;

create index if not exists notify_log_sent_idx on public.notify_log (sent_at desc);

-- ---------------------------------------------------------
-- 2. The notifier
--
-- Everything is wrapped so a notification problem can never fail a
-- registration. A company submitting their fleet must not see an error
-- because our mail provider is down.
-- ---------------------------------------------------------

create or replace function public.notify_new_submission()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  s       public.notify_settings;
  v_html  text;
  v_subj  text;
  v_ref   text := coalesce(new.ref, upper(left(new.id::text, 8)));
begin
  select * into s from public.notify_settings where id = 1;

  if s.id is null or not s.enabled
     or nullif(btrim(coalesce(s.resend_api_key, '')), '') is null
     or coalesce(array_length(s.to_emails, 1), 0) = 0 then
    return new;   -- not configured yet; stay quiet
  end if;

  v_subj := 'New registration: ' || new.company_name ||
            ' (' || new.equipment_count || ' machines)';

  v_html :=
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px">' ||
    '<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b726d;margin:0 0 4px">' ||
      'Spirtas Worldwide &middot; Fleet Intake</p>' ||
    '<h2 style="font-size:20px;margin:0 0 14px;color:#1a1a1a">' ||
      replace(new.company_name, '<', '&lt;') || '</h2>' ||
    '<table cellpadding="6" style="border-collapse:collapse;font-size:14px;color:#202422">' ||
      '<tr><td style="color:#6b726d">Reference</td><td><b>' || v_ref || '</b></td></tr>' ||
      '<tr><td style="color:#6b726d">Machines</td><td><b>' || new.equipment_count || '</b></td></tr>' ||
      '<tr><td style="color:#6b726d">Contact</td><td>' || replace(coalesce(new.contact_person, ''), '<', '&lt;') || '</td></tr>' ||
      '<tr><td style="color:#6b726d">Email</td><td><a href="mailto:' || coalesce(new.email, '') || '">' ||
        replace(coalesce(new.email, ''), '<', '&lt;') || '</a></td></tr>' ||
      '<tr><td style="color:#6b726d">Phone</td><td>' || replace(coalesce(new.phone, ''), '<', '&lt;') || '</td></tr>' ||
      '<tr><td style="color:#6b726d">Language</td><td>' || upper(coalesce(new.language, 'en')) || '</td></tr>' ||
    '</table>' ||
    '<p style="margin:20px 0 0"><a href="' || s.dashboard_url ||
      '" style="background:#79b254;color:#fff;padding:11px 20px;border-radius:8px;' ||
      'text-decoration:none;font-weight:600;display:inline-block">Open the dashboard</a></p>' ||
    '<p style="font-size:12px;color:#6b726d;margin-top:22px">' ||
      'Sent automatically when a company registers.</p></div>';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || s.resend_api_key,
                 'Content-Type',  'application/json'),
    body    := jsonb_build_object(
                 'from',    s.from_name || ' <' || s.from_email || '>',
                 'to',      to_jsonb(s.to_emails),
                 'subject', v_subj,
                 'html',    v_html)
  );

  insert into public.notify_log (submission_id, company_name, ok, detail)
  values (new.id, new.company_name, true, 'queued to ' || array_to_string(s.to_emails, ', '));

  return new;

exception when others then
  -- A registration must never fail because of a notification.
  begin
    insert into public.notify_log (submission_id, company_name, ok, detail)
    values (new.id, new.company_name, false, left(sqlerrm, 300));
  exception when others then
    null;
  end;
  return new;
end;
$fn$;

comment on function public.notify_new_submission() is
  'Emails the team when a company registers. Failures are logged and swallowed so a submission is never lost.';

drop trigger if exists trg_notify_new_submission on public.submissions;

-- Only web submissions. A bulk import of ten companies should not send ten
-- emails, so rows loaded from a spreadsheet are skipped.
create trigger trg_notify_new_submission
  after insert on public.submissions
  for each row
  when (new.source = 'web')
  execute function public.notify_new_submission();

-- ---------------------------------------------------------
-- 3. Turn it on  — EDIT THE THREE VALUES BELOW, THEN RUN THIS
--
-- Get an API key at https://resend.com (free: 3,000 emails a month).
-- Dashboard -> API Keys -> Create, with "Sending access" only.
--
-- from_email: leave onboarding@resend.dev to start. It works with no
-- setup but is rate limited and can land in spam. Once you verify
-- spirtasworldwide.com at resend.com/domains, change it to something
-- like fleet@spirtasworldwide.com for reliable delivery.
-- ---------------------------------------------------------

-- Uncomment, paste your key, and run. Or use 008-turn-on-email.sql,
-- which does this with a before/after check around it.
/*
update public.notify_settings set
  resend_api_key = 're_XXXXXXXXXXXXXXXXXXXXXXXX',
  to_emails      = array['yesman.utrera@spirtasworldwide.com'],
  from_email     = 'onboarding@resend.dev',
  from_name      = 'Spirtas Fleet Intake',
  enabled        = true,
  updated_at     = now()
where id = 1;
*/

-- ---------------------------------------------------------
-- 4. Test it without waiting for a real registration
--
--   select public.test_notification();
--
-- Then check your inbox, and check what happened:
--
--   select sent_at, company_name, ok, detail
--   from public.notify_log order by sent_at desc limit 10;
--
-- pg_net records the provider's reply separately. A 200 there means
-- Resend accepted it:
--
--   select id, status_code, content from net._http_response
--   order by id desc limit 5;
-- ---------------------------------------------------------

create or replace function public.test_notification()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  s      public.notify_settings;
  v_id   bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  select * into s from public.notify_settings where id = 1;

  if nullif(btrim(coalesce(s.resend_api_key, '')), '') is null then
    return 'No API key set. Fill in section 3 of this file first.';
  end if;
  if coalesce(array_length(s.to_emails, 1), 0) = 0 then
    return 'No recipients set. Fill in to_emails in section 3.';
  end if;
  if not s.enabled then
    return 'Notifications are switched off (enabled = false).';
  end if;

  select net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || s.resend_api_key,
                 'Content-Type',  'application/json'),
    body    := jsonb_build_object(
                 'from',    s.from_name || ' <' || s.from_email || '>',
                 'to',      to_jsonb(s.to_emails),
                 'subject', 'Fleet Intake — test notification',
                 'html',    '<div style="font-family:Arial,sans-serif">' ||
                            '<h2>Notifications are working</h2>' ||
                            '<p>If you can read this, a real registration will reach you the same way.</p>' ||
                            '<p style="font-size:12px;color:#6b726d">Sent by test_notification().</p></div>')
  ) into v_id;

  return 'Queued to ' || array_to_string(s.to_emails, ', ') ||
         '. Check your inbox, then: select status_code, content from net._http_response where id = ' ||
         v_id || ';';
end;
$fn$;

revoke all on function public.test_notification() from public, anon;
grant execute on function public.test_notification() to authenticated;
