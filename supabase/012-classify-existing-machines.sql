-- =========================================================
-- Spirtas Worldwide — Fleet Intake
-- Migration 012: let an admin classify machines already loaded.
--
-- Why the Machines view looked broken
-- -----------------------------------
-- The consolidated master was imported before 006 added the
-- scope column. 006 gave that column a default of 'review',
-- so every row already in the table became 'review'.
--
-- The Machines view opens on the Fleet button, which shows
-- scope = 'in'. Nothing was 'in', so the table was empty and
-- said only "No machines match" — indistinguishable from a
-- broken page.
--
-- Two halves to the fix. The dashboard now explains an empty
-- table and offers the button that has the rows, so this is
-- no longer a dead end whatever the data says. This migration
-- is the other half: it lets an admin actually set the scope.
--
-- 006 already assumed this was possible ("an admin can change
-- any row's scope from the dashboard") but the policy to allow
-- it was never added. Equipment was readable and nothing more.
--
-- Safe to re-run.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Where things stand
--
-- Run this first. If 'in' is 0 and 'review' is large, that is
-- the empty Machines table explained.
-- ---------------------------------------------------------

select coalesce(scope, 'review') as scope,
       count(*)                  as rows,
       coalesce(sum(qty), count(*)) as units
from public.equipment
group by 1
order by 2 desc;


-- ---------------------------------------------------------
-- 2. Allow an admin to set it
--
-- Read access already exists. This adds update, under the same
-- is_admin() test every other admin policy uses, so the rule is
-- unchanged: signed in AND on the allowlist in public.admins.
--
-- The check clause repeats the condition so an admin cannot
-- write a row they would not also be allowed to read.
-- ---------------------------------------------------------

drop policy if exists "admins update equipment" on public.equipment;

create policy "admins update equipment"
  on public.equipment for update to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------
-- 3. Now classify, from the dashboard
--
-- Machines view -> "Classify unreviewed". It runs the same
-- assets/scope.js the intake form and the importer use, so a
-- machine is judged identically however it arrived. That is
-- the reason this file does not reimplement the keyword lists
-- in SQL: two copies of that vocabulary would drift, and the
-- one in SQL would be the one nobody remembers to update.
--
-- Nothing is deleted by classifying. A row judged 'out' is set
-- aside and still visible under the "Set aside" button, and
-- anything unclear stays in 'review' for a person to decide.
-- ---------------------------------------------------------


-- ---------------------------------------------------------
-- 4. Confirm afterwards
-- ---------------------------------------------------------

-- select coalesce(scope, 'review') as scope, count(*) as rows
-- from public.equipment group by 1 order by 2 desc;

-- To undo a classification run and start over:
--
--   update public.equipment set scope = 'review', scope_reason = null;
