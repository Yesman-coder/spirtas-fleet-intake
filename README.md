# Fleet Intake — Spirtas Worldwide

A bilingual (English/Spanish) registration page where machinery companies
register themselves and submit their equipment list — either typed in row
by row, or uploaded as a CSV/Excel file. Every submission is written as
rows into a Google Sheet you control, and (optionally) triggers an email
notification.

No backend server, no database, no monthly hosting cost: the page is
static files on GitHub Pages, and Google Sheets + Apps Script act as the
free backend.

```
index.html              the page
assets/style.css        styling (brand colors, layout)
assets/i18n.js          every English/Spanish string, in one place
assets/app.js           form logic, file parsing, submission
assets/logo.png         your logo
apps-script/Code.gs      the Google Sheets backend — paste into Apps Script
```

There are two things to set up before this is live: **GitHub Pages** (the
website itself) and **the Google Sheet + Apps Script** (where submissions
land). Do them in this order — you need the Apps Script URL before the
site can submit anywhere.

---

## 1. Set up the Google Sheet (backend)

1. Create a new Google Sheet (or open an existing one you want to use).
   Rename it to something like **Fleet Intake — Submissions**.
2. In the Sheet, open **Extensions → Apps Script**.
3. Delete whatever is in the default `Code.gs` file, and paste in the
   entire contents of `apps-script/Code.gs` from this folder.
4. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - **Execute as:** `Me`
   - **Who has access:** `Anyone` (this is required — the companies
     submitting the form are not logged into your Google account)
   - Click **Deploy**, then **Authorize access** and approve the
     permissions prompt (it needs permission to edit this specific
     Sheet and send outbound requests for the email notification).
5. Copy the **Web app URL** it gives you. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`
6. Open `assets/app.js` in this project, find this line near the top:
   ```js
   var APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
   and replace the placeholder with the URL you just copied.

Submitting the form now appends one row to a **Companies** tab and one
row per machine to an **Equipment** tab (both created automatically on
first submission), joined by a shared **Submission ID** column.

> **If you ever edit `Code.gs` again:** re-run **Deploy → Manage
> deployments → (pencil icon) → New version → Deploy**. Just saving the
> file is not enough — Apps Script web apps only pick up changes on a new
> deployment version.

### Optional: email yourself when someone registers

The backend can email a notification through
[Resend](https://resend.com) every time a submission comes in. This is
entirely optional and the sheet works fine without it.

**Your API key never goes into any file in this project or on GitHub.**
Instead, set it as a private Script Property, which lives only inside
your Google account:

1. In the Apps Script editor, click the gear icon (**Project Settings**)
   in the left sidebar.
2. Scroll to **Script Properties → Add script property**, and add:

   | Property | Value |
   |---|---|
   | `RESEND_API_KEY` | your Resend API key |
   | `NOTIFY_EMAIL` | `luis.alejandro@spirtasworldwide.com` |

   `NOTIFY_EMAIL` defaults to that address in the code even if you skip
   it — add it only if you want to change or add recipients later.

3. By default, notification emails send from `onboarding@resend.dev`,
   which works immediately with no setup but is rate-limited and meant
   for testing. For reliable day-to-day delivery, [verify your domain in
   Resend](https://resend.com/domains) and add one more property:

   | Property | Value |
   |---|---|
   | `RESEND_FROM_EMAIL` | e.g. `notifications@spirtasworldwide.com` |

4. Test it: back in the Apps Script editor, pick `testNotificationEmail`
   from the function dropdown at the top and click **Run**. Check
   `luis.alejandro@spirtasworldwide.com` for a sample email. (The very
   first run will ask you to authorize permissions again — that's normal.)

If `RESEND_API_KEY` is never set, `doPost` just skips the email step —
submissions still save to the Sheet normally.

---

## 2. Publish the site on GitHub Pages

1. Create a new **public** repository on GitHub (GitHub Pages' free tier
   requires a public repo unless you're on a paid plan) — for example
   `spirtas-fleet-intake`.
2. Push everything in this folder to it:
   ```bash
   cd fleet-intake-site
   git init
   git add .
   git commit -m "Fleet intake registration site"
   git branch -M main
   git remote add origin https://github.com/<your-org-or-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub, open the repo's **Settings → Pages**.
   - **Source:** `Deploy from a branch`
   - **Branch:** `main`, folder `/ (root)`
   - Save.
4. GitHub will publish the site within a minute or two at:
   `https://<your-org-or-username>.github.io/<repo-name>/`

   (If you have a custom domain like `equipment.spirtasworldwide.com`,
   add it under **Settings → Pages → Custom domain** and follow GitHub's
   DNS instructions — a `CNAME` record pointing at your `github.io`
   address.)

That's it — the page is live, bilingual, on-brand, and every submission
lands in your Sheet.

---

## Customizing

- **Wording / translations** — everything shown on the page lives in
  `assets/i18n.js` as two parallel objects, `I18N.en` and `I18N.es`. Edit
  either freely; there's no need to touch `index.html` for text changes.
- **Colors** — all brand colors are CSS custom properties at the top of
  `assets/style.css` (`--brand-green`, `--brand-gray`, etc.), sampled
  from your logo. Change them in one place to re-theme the whole page.
- **Company fields** — to add/remove a registration field (e.g. a
  country dropdown), add the `<input>` in `index.html`'s Company section,
  add it to the `validateCompany()` field list and the `payload.company`
  object in `assets/app.js`, and add a column to `COMPANY_HEADERS` /
  the `appendRow(...)` call in `apps-script/Code.gs`.
- **Equipment columns** — the 9 columns (Brand, Type, Model, ID,
  Capacity, Age, Location, Price/Day, Contact) are driven by the
  `EQ_COLS` array in `assets/app.js` and mirrored in `EQUIPMENT_HEADERS`
  in `Code.gs` — keep the two in sync if you add or rename a column, and
  add matching entries to `HEADER_ALIASES` in `assets/i18n.js` so
  uploaded spreadsheets with that column still auto-match.

## How file uploads are matched

When someone uploads a CSV/XLSX, the first row is read as headers and
matched — case- and accent-insensitive, English or Spanish — against
`HEADER_ALIASES` in `assets/i18n.js` (e.g. `Brand`/`Marca`, `Price/Day`
and `Precio/Día` all map to the same field). Unmatched columns are
ignored; unmatched required fields are just left blank for the company
to fill in by hand in the review table before submitting. Parsing
happens entirely in the visitor's browser via
[SheetJS](https://sheetjs.com/) — no file is uploaded anywhere until they
hit Submit, at which point it's sent as plain structured data (not the
original file).

## A technical note on how submissions reach the Sheet

The page posts to the Apps Script URL through a hidden `<form>` targeting
a hidden `<iframe>`, not a `fetch()` call. This is deliberate: Google
Apps Script web apps don't reliably return CORS headers, which makes
`fetch()` from another origin (your GitHub Pages domain) unreliable. A
plain form POST has no such restriction — the browser never needs to
read the response, it just has to deliver it — so this is the standard,
dependency-free way to post from a static site to Apps Script.

The trade-off: the page can't read a real success/failure response back,
so it shows a success message optimistically ~1.4 seconds after
submitting. If Apps Script rejects the request outright (e.g. it's not
deployed with "Anyone" access), the submission simply won't appear in
the Sheet with no visible error on the page — so test a real submission
end-to-end after deploying, and check the **Errors** tab (created
automatically) if something seems off. The **Download a copy** button on
the success screen also gives the submitting company a CSV of exactly
what they sent, as a safety net.
