-- Paste into the Supabase SQL Editor. Read-only, changes nothing.
select
  s.company_name,
  s.source                                as came_from,
  s.equipment_count                       as machines,
  (select count(*) from public.equipment e where e.submission_id = s.id) as machine_rows,
  to_char(s.submitted_at, 'YYYY-MM-DD HH24:MI') as submitted,
  s.status
from public.submissions s
order by s.submitted_at desc;

-- If ONE row comes back with ~1100 machines, the whole master file went in
-- through the public form, which registers one company per submission.
-- If several rows come back, the SQL imports are working and some are missing.

select count(*) as companies,
       sum(equipment_count) as machines_total,
       count(*) filter (where source = 'master') as from_sql_import,
       count(*) filter (where source = 'web')    as from_the_form
from public.submissions;
