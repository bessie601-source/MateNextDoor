# Mate Next Door: website

Static one-page site plus one serverless function (`api/quote.js`) that emails quote requests to Will. Built for Vercel.

## Before launch
1. **Email address:** the site shows `will@matenextdoor.com`. Change it in `index.html` if the domain is different.

## Going live
1. **Domain:** done: `matenextdoor.com`.
2. **Hosting:** deploy this folder to Vercel and add the domain under Project → Domains.
3. **Email inbox:** set up Google Workspace (or forwarding) for `will@…` by adding its MX records at the domain's DNS.
4. **Quote form:** create a free Resend account, verify the domain (adds a few DNS records), then set these in Vercel → Settings → Environment Variables:
   - `RESEND_API_KEY`
   - `QUOTE_TO_EMAIL` = `will@matenextdoor.com`
   - `QUOTE_FROM_EMAIL` = `website@matenextdoor.com`

   Until these are set, the form shows "please call or email Will directly".

## Appointment planner (`/appointmentplanner/`)
Will's private planner: schedule, clients, and jobs from quote to payment (Job IDs `MND-YYYY-NNN`, 30% deposit, variations, balance invoice, V1 → V2 → V3 reminders). It's not linked from the public site and asks for a sign-in. Data lives in Supabase.

One-off setup:
1. **Supabase project:** create one at supabase.com (free tier is plenty).
2. **Database:** open SQL Editor, paste `supabase/planner.sql` and run it. It creates the tables, locks them down with row-level security and puts `will@matenextdoor.com` on the access list (edit the last line first if Will signs in with another address).
3. **Sign-ins:**
   - Authentication → Sign In / Providers: turn off **Allow new users to sign up**.
   - Authentication → Users → Add user: Will's email and a password, with **Auto confirm** on.
   - Authentication → URL Configuration: set Site URL to `https://matenextdoor.com` and add `https://matenextdoor.com/appointmentplanner/` under Redirect URLs, so **Forgot password** links work.
4. **Vercel → Settings → Environment Variables:**
   - `SUPABASE_URL` = the project URL (Project Settings → API)
   - `SUPABASE_ANON_KEY` = the anon / publishable key (never the service_role key)

   Until these are set, the planner shows example data and says it can't save.

To give someone else access: add their user in Supabase, then run `insert into public.planner_members (email) values ('their@email');`.

## Files
- `index.html`: the page
- `styles.css`: black / white / card red (`#e11b1b`), Barlow + Barlow Condensed
- `quote.js`: form submit
- `api/quote.js`: emails the request via Resend
- `img/icons/`: the 14 service icons, cut from Will's printed card
- `appointmentplanner/index.html`: the planner
- `appointmentplanner/store.js`: sign-in and saving through Supabase
- `appointmentplanner/vendor/`: supabase-js 2.45.4 (browser build)
- `api/planner-config.js`: gives the planner its Supabase URL and public key
- `supabase/planner.sql`: tables and access rules for the planner
