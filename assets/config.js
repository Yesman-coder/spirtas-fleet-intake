/* =========================================================
   Spirtas Worldwide — Fleet Intake
   Supabase connection settings. Used by both the public
   intake form and the admin dashboard.

   >>> SETUP: fill in the two values below. <<<
   Supabase dashboard -> Project Settings -> Data API:
     - "Project URL"  goes in `url`
     - "anon public"  key goes in `anonKey`

   These two values are safe to commit and safe to serve on a
   public page. The anon key identifies the project, it does not
   grant access: every table has row-level security enabled, and
   the anon role can do exactly one thing — call the
   submit_fleet_intake() function. Reading submissions requires a
   signed-in account on the admin allowlist. See supabase/schema.sql.

   Never put the `service_role` key in this file. That one does
   bypass row-level security, and this file is public.
   ========================================================= */

window.SUPABASE_CONFIG = {
  url: 'https://aerxypwvaqlrnvikwmhr.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcnh5cHd2YXFscm52aWt3bWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDIzNzAsImV4cCI6MjEwNTIxODM3MH0.OZ01E2dkkpm7QUXuc1Qs6IXR0UIDraP3ienSGSAO_LI'
};

window.SUPABASE_CONFIG.isConfigured = function () {
  var c = window.SUPABASE_CONFIG;
  return !!(c.url && c.anonKey &&
    c.url.indexOf('PASTE_YOUR') !== 0 &&
    c.anonKey.indexOf('PASTE_YOUR') !== 0);
};
