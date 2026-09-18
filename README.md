# Fleet Intake — Spirtas Worldwide

A bilingual (English/Spanish) registration page where machinery companies
register themselves and submit their equipment list — either typed in row
by row, or uploaded as a CSV/Excel file. Every submission lands in a
Supabase (Postgres) database, and an admin dashboard on the same site
shows everyone who has registered, with CSV and Excel export.

The site itself is static files on GitHub Pages, so there is no server to
run or pay for. Supabase's free tier covers the database and the admin
logins.

```
index.html               the public registration page
admin.html               the admin dashboard (login required)
assets/config.js         >>> your Supabase URL + anon key go here <<<
assets/style.css         styling for the public page (brand colors, layout)
assets/admin.css         styling for the dashboard
assets/i18n.js           every English/Spanish string, in one place
assets/app.js            form logic, file parsing, submission
assets/admin.js          dashboard: auth, table, filters, export
assets/logo.png          your logo
supabase/schema.sql      the database — paste into the Supabase SQL editor
```

**Live site:** https://yesman-coder.github.io/spirtas-fleet-intake/
**Dashboard:** https://yesman-coder.github.io/spirtas-fleet-intake/admin.html

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign in, and click
   **New project**.
   - **Name:** `spirtas-fleet-intake`
   - **Database password:** generate one and save it in your password
     manager. You will not need it for day-to-day use, but you cannot
     recover it later.
   - **Region:** pick the one closest to your team.
2. Wait for it to finish provisioning (about two minutes).

## 2. Create the tables

1. In the Supabase dashboard, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase/schema.sql` from this project, copy the whole file, and
   paste it into the editor.
4. Click **Run**.

You should see `Success. No rows returned`. This creates two tables
(`submissions` and `equipment`), an `admins` allowlist, the row-level
security policies, and the two functions the site calls.

The script is safe to re-run if you ever need to reapply it.

## 3. Connect the site to the project

1. In Supabase, go to **Project Settings → Data API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `assets/config.js` in this project and paste them in:
   ```js
   window.SUPABASE_CONFIG = {
     url: 'https://abcdefghijkl.supabase.co',
     anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
   };
   ```
4. Commit and push. GitHub Pages redeploys within a minute.

> **Is it safe to commit the anon key?** Yes — that is what it is for. It
> identifies the project, it does not grant access. Every table has
> row-level security switched on, and the anon key's only privilege is
> calling `submit_fleet_intake()`. It cannot read a single registration.
>
> The **`service_role`** key is the dangerous one: it bypasses row-level
> security entirely. Never put it in this project, in a browser, or in
> any file you push to GitHub.

## 4. Create your admin login

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
   - Enter your email and a password.
   - Tick **Auto Confirm User** so you can sign in straight away.
2. Go back to the **SQL Editor** and run this, with your own email:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@spirtasworldwide.com'
   on conflict (user_id) do nothing;
   ```
3. Open `admin.html` on the live site and sign in.

Repeat both steps for each teammate who should see the dashboard. To
revoke someone's access, delete their row from `public.admins` — their
login still works but they will see nothing and be signed straight back
out.

### Recommended: turn off public sign-ups

**Authentication → Sign In / Providers → Email** and switch **Allow new
users to sign up** off. The `admins` allowlist already blocks a
self-registered account from reading anything, but this stops strangers
creating accounts in your project at all.

---

## 5. Publish the site on GitHub Pages

Already done for this repo — it serves from `main`, root, at
https://yesman-coder.github.io/spirtas-fleet-intake/.

If you are setting this up somewhere new:

1. Create a **public** repository on GitHub (Pages' free tier requires
   a public repo).
2. Push this folder to it.
3. **Settings → Pages → Source:** `Deploy from a branch`, **Branch:**
   `main`, folder `/ (root)`.

For a custom domain like `equipment.spirtasworldwide.com`, add it under
**Settings → Pages → Custom domain** and follow GitHub's DNS
instructions (a `CNAME` record pointing at your `github.io` address).

---

## Using the dashboard

The dashboard has four views, on the toggle under the title:

| View | What it answers |
|---|---|
| **Companies** | Who has registered, as a filterable table. |
| **Machines** | How many of a given machine exist across every company. |
| **Our fleet** | What Spirtas already controls, and where we are short. |
| **Activity** | What arrived, and when. Grouped by day, newest first, with anything since your last visit flagged. |

**Search** covers company name, contact person, email, phone and the
reference code. **Status** and the date range narrow the list further.
Every filter runs in the database, so it searches everything, not just
what is currently on screen.

**Click any row** to see that company's full machinery list, change its
status, or download just that company's list.

**Statuses** are `new` → `reviewed` → `archived`. They are only for your
own triage; the company never sees them.

**Deleting** is permanent and takes the machines with it, because
`public.equipment` is `ON DELETE CASCADE`. Two ways in:

- **One at a time** — expand a registration and use **Delete**, in either
  the Companies table or the Activity feed. The dialog names the company
  and how many machines go with it.
- **Several at once** — tick the boxes in the left-hand column of the
  Companies table, then **Delete selected**. Because this is the table
  that also holds the imported subcontractor registrations, a multi-row
  delete lists what is about to go and makes you type `DELETE` first.

Select-all covers the rows currently loaded, not the whole filtered set,
so a tick can never remove something that was never on screen to read.

If you only want a registration out of the way, **archive** it instead.
The record survives and drops out of the default filter.

Deletion is allowed by the `admins delete submissions` policy in
`schema.sql`, so it is the database that decides who may do it, not the
dashboard. If your account is not on the admin list the delete removes
nothing and the dashboard says so rather than pretending it worked.

---

## Machines: Fleet, Review and Set aside

Every machine carries a **scope**, because a company list often includes
everything they own. `assets/scope.js` reads what each row says it is and
sorts it into one of three:

| Scope | Button | Meaning |
|---|---|---|
| `in` | **Fleet** | Demolition or construction plant. The real answer to "how many excavators do we have". |
| `out` | **Set aside** | Pickups, laboratory kit, office furniture. Kept, visible, never counted. |
| `review` | **Review** | Not clear either way. Waits for a person, because quietly dropping a real excavator is worse than a short list to check. |

Nothing is ever discarded. The Machines view opens on **Fleet**.

### If the Machines view looks empty

That is the expected symptom of unclassified data, not a broken page. A
machine only gets a scope when it is imported through a version of the
app that has the classifier. The consolidated master was loaded before
`006-scope-filter.sql` added the column, so those rows all took its
`review` default, and opening on **Fleet** showed nothing.

The view now says so, with the counts, and offers the button that has the
rows. To sort them properly:

1. Run `supabase/012-classify-existing-machines.sql`. It adds the
   `admins update equipment` policy, without which nothing can change a
   scope. The query at the top also shows how the rows are currently split.
2. In the Machines view, press **Classify unreviewed**.

That runs the same `assets/scope.js` the intake form and the importer use,
so a machine is judged identically however it arrived. The keyword lists
are deliberately not mirrored in SQL: one vocabulary means one place to
edit when a new spelling turns up, and no chance of the two drifting.

Re-running it is safe. Anything still unclear stays in **Review**, and you
can reset everything with the statement at the bottom of migration 012.

**Download CSV** exports whatever the current filters are showing:

| Option | What you get |
|---|---|
| **Companies** | One row per registration. Good for a contact list. |
| **Equipment** | One row per machine, with its company's details repeated on each row. Good for sorting and filtering equipment in Excel. |
| **Everything** | An `.xlsx` workbook with both of the above as separate sheets. |

CSV files are written with a UTF-8 marker so accented Spanish text opens
correctly in Excel.

**Reference codes** are the first eight characters of a submission's
database id, shown to the company on the confirmation screen. If someone
emails asking about `A1B2C3D4`, paste that into the search box.

---

## Customizing

- **Wording / translations** — everything shown on the public page lives
  in `assets/i18n.js` as two parallel objects, `I18N.en` and `I18N.es`.
  Edit either freely; there is no need to touch `index.html` for text
  changes. (The dashboard is English-only, since it is internal.)
- **Colors** — all brand colors are CSS custom properties at the top of
  `assets/style.css` (`--brand-green`, `--brand-gray`, etc.), sampled
  from the logo. Change them in one place to re-theme both pages. Both
  pages follow the operating system's light/dark setting.
- **Company fields** — to add a registration field (e.g. a country
  dropdown), add the `<input>` to `index.html`'s Company section, add it
  to the `validateCompany()` field list and the `payload.company` object
  in `assets/app.js`, add a column to `public.submissions` and to the
  `insert` inside `submit_fleet_intake()` in `supabase/schema.sql`, then
  add it to the dashboard table in `assets/admin.js`.
- **Equipment columns** — the nine columns (Brand, Type, Model, ID,
  Capacity, Age, Location, Price/Day, Contact) are driven by the
  `EQ_COLS` array in `assets/app.js`, mirrored in `EQ_COLS` in
  `assets/admin.js` and in the `public.equipment` table. Keep all three
  in sync if you add or rename a column, and add matching entries to
  `HEADER_ALIASES` in `assets/i18n.js` so uploaded spreadsheets with
  that column still auto-match.

## Accepting whatever a company sends

Companies send the list they already keep, not the list we asked for. In
practice that means a title row and a division row above the headers,
several sheets where the first one is a summary with no equipment in it,
and column names nobody agreed on (`DESCRIPCION`, `PLACA / SERIAL`,
`ESTATUS`, `N°`).

So the upload does not assume anything:

1. **Every sheet is read**, not just the first. Each one is scored on how
   many recognisable columns it has and how many data rows follow, and the
   best is preselected. A "Dashboard Resumen" summary sheet loses to the
   real inventory sheet behind it.
2. **The header row is found**, not assumed to be row 1. The first 25 rows
   are scanned and the one that looks most like headers wins.
3. **The guess is shown, not applied.** A review panel appears with the
   chosen sheet, the header row, and a dropdown per field. Anything wrong
   gets corrected there, with a live three-row preview, before a single row
   is added.
4. **Unrecognised columns are kept**, not dropped. They ride along in
   `equipment.extras` as `{"COLUMN NAME": "value"}`, so a column nobody
   anticipated is still there when you clean the data up later.

Nothing has to be right at submission time. Collect first, clean after.

### Cleaning up later

See which unmapped columns keep turning up:

```sql
select k as column_name, count(*) as rows
from public.equipment e, lateral jsonb_object_keys(e.extras) k
where e.extras is not null
group by 1 order by 2 desc;
```

If one appears often, add its spelling to `HEADER_ALIASES` in
`assets/i18n.js` and it maps automatically from then on. To promote values
already collected into a real field:

```sql
update public.equipment
   set unit_id = extras ->> 'SERIAL'
 where unit_id is null and extras ? 'SERIAL';
```

## How file uploads are matched

When someone uploads a CSV/XLSX, the first row is read as headers and
matched — case- and accent-insensitive, English or Spanish — against
`HEADER_ALIASES` in `assets/i18n.js` (e.g. `Brand`/`Marca`, `Price/Day`
and `Precio/Día` all map to the same field). A header that carries both
languages or a trailing unit, like `BRAND / MARCA` or
`PRICE PER DAY (24 HR) USD`, is tried whole and then split on `/`.
Unmatched columns are ignored; unmatched required fields are left blank
for the company to fill in by hand in the review table before
submitting.

Parsing happens entirely in the visitor's browser via
[SheetJS](https://sheetjs.com/) — no file is uploaded anywhere. On
submit, only the structured rows are sent, never the original file.

## How a submission reaches the database

The page POSTs the whole payload to one Postgres function,
`submit_fleet_intake()`, which validates it and writes the company row
plus every equipment row inside a single transaction. Either all of it
saves or none of it does — a submission can never land half-written.

The function runs as `security definer`, which is what lets the public
page write without the anon key having any table permissions of its own.
It re-checks the required fields, the email format, and caps a single
submission at 5,000 machines.

Because the browser gets a real response back, the success screen only
appears once the database has confirmed the write. If something fails,
the company sees the reason, their typed list is still on screen, and
they can fix it and submit again without retyping anything.


## Knowing when someone registers

The **Activity** view is the answer to "has anyone registered?". It lists
every submission in the order it arrived, newest first, grouped by day:
*Today*, *Yesterday*, then dated headers, each entry carrying the exact
time it landed.

Anything that arrived since you last opened the view is flagged
**Unseen**, with a count at the top: *"3 new registrations since your last
visit, Sep 17 at 5:03 PM."* Open the view and the flags stay put while you
read, so a refresh does not wipe them; **Mark all as seen** clears them
when you are done.

That watermark is stored in your own browser, not the database. It answers
a question about one person at one desk, so two admins looking at the same
data never clear each other's marks. In a private window, or with site
data blocked, the marks simply do not appear and the rest of the view
works normally.

The filters are **All / Form / Imported** and a date range. *Form* is what
companies submitted themselves; *Imported* is what an admin loaded from a
spreadsheet, which is why a bulk import shows as a cluster of entries all
at the same minute. Click any entry to expand its machinery list, change
its status, or download just that company's list.

### There is no email notification

There was one, built on a Postgres trigger and [Resend](https://resend.com).
It is gone: `supabase/011-retire-email-notifications.sql` removes the
trigger, both functions, and the `notify_settings` and `notify_log`
tables.

If you applied the old `007` migration to a database, run `011` against
it. `notify_settings` held a live Resend API key, and dropping the table
is the point of the migration as much as stopping the sends. Rotate or
delete that key at resend.com/api-keys too, since a credential is only
really gone once the provider says so.

---

## Limits worth knowing

- **The public endpoint is not rate limited.** Anyone who finds the page can
  submit. The database caps a single submission at 5,000 machines, but
  nothing stops someone scripting many small ones. For a low-traffic B2B
  intake form that is usually fine; if it becomes a problem, put Cloudflare
  in front of the site or add a CAPTCHA before the submit button.
- **Repeat submissions inside two minutes are collapsed.** If the same
  company name, email and machine count arrive again within two minutes,
  the database returns the original reference instead of writing a second
  row. This is what stops a dropped connection from creating duplicates. A
  genuinely different submission always gets its own row.
- **Free-tier projects pause after a week of no activity.** Supabase pauses
  inactive free projects, which would make the form fail until you restore
  it from the dashboard. Once registrations are coming in regularly this
  never triggers; during a quiet period, check the project is awake.
- **Exports are capped at 10,000 registrations** per download. Past that,
  narrow the date range and export in batches.

## Troubleshooting

**"This form isn't connected to its database yet"** — `assets/config.js`
still has the placeholder values. See step 3.

**Sign-in says "not on the admin list"** — the account exists but step 4's
`insert` has not been run for that email.

**Dashboard loads but shows no registrations** — check
**Table Editor → submissions** in Supabase. If rows are there but the
dashboard is empty, the signed-in user is not in `public.admins`.

**A submission failed with a message from the server** — the text comes
straight from `submit_fleet_intake()`, so it names the actual problem
(missing field, bad email, list too long).
