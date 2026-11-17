# Opus Revenue Desk

An internal revenue tool for **Opus Residences, Imperial KLCC and Banyan Signatures**. You upload the eZee and Lighthouse exports, and it gives you:

- rate recommendations for every room type and date
- room-type and nationality performance
- competitor moves and OTA positioning
- a strategy write-up (rules-based, or AI via Gemini)

It's static HTML/CSS/JS with no build step. Data lives in **Supabase**, and the site runs on **Vercel**.

```
/index.html            landing page (Home / Dashboard)
/home/                 Upload · Rates · OTA ratings · Room types · Settings
/dashboard/            KPIs, charts, tables, strategy write-up
/shared/app.js         config loader, Supabase client, parsers, RULES (rate thresholds)
/shared/styles.css
/api/config.js         Vercel function: public config + which keys exist
/api/ai.js             Vercel function: Gemini call with the server-side key
/supabase/schema.sql   tables, views, RLS, seed + sample data
PLAN.md                build plan
API_KEYS_GUIDE.md      step-by-step for every key
```

## Run it locally

You need a local web server, because opening the HTML files directly won't work:

```bash
npx serve .            # or: python -m http.server 8080
```

Open the printed address. With no Vercel config, the tool shows **Connect your Supabase**. Paste the Project URL and publishable key, then click **Test connection** and **Save & continue**.

## Deploy to Vercel

1. Push this folder to a **private** GitHub repo, then go to vercel.com and choose **Add New → Project →** import (framework preset **Other**, no build command). Or run `npx vercel` in this folder.
2. Under **Settings → Environment Variables**, add:
   - `SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY`: the **publishable** key (`sb_publishable_…`)
   - `GEMINI_API_KEY`: optional; turns on AI write-ups
   - `GEMINI_MODEL`: optional; default `gemini-flash-latest`
3. Redeploy. Then open the site, go to **Home › Settings** and check that every key shows **Found (Vercel)**.

Vercel's Hobby plan is for non-commercial use, so day-to-day business use needs Vercel Pro. Free Supabase projects pause after 7 days without activity; restore them from the Supabase dashboard.

## Monthly routine

1. **Home › Upload:** drop the eZee *Monthly Statistics* exports (one per hotel), the eZee *reservation list*, and the Lighthouse *Rate Insight* and *Market Insight* exports.
2. **Home › OTA ratings:** enter this month's Agoda, Booking.com and Trip.com ratings for your hotel and competitors.
3. **Home › Rates:** review the 60-day grid, click any rate to see why it landed there, and export it as CSV.
4. **Dashboard:** review, then click **Write strategy**.

## Security (demo mode)

`schema.sql` lets the browser key read and write every table, so **anyone with the site URL can see and change the data**. Before uploading real figures, switch to team login: Supabase email/password users, and RLS policies limited to `authenticated`. The tool never stores guest names, emails or phone numbers from the reservation list.

## Tuning the recommendations

Every threshold is in `RULES` at the top of `shared/app.js`: demand bands, occupancy steps, room-type pickup, the competitor band, rounding and the minimum nights for the nationality ranking.
