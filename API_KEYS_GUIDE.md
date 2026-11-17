# API keys & accounts — Opus Revenue Desk

The tool needs **two public Supabase values** (required), **one optional Gemini key**, and a **Vercel account** to put it online.

| # | What | Required? | Free? | Env var on Vercel | Paste in the tool (demo) |
|---|---|---|---|---|---|
| 1 | Supabase Project URL | Yes | Yes | `SUPABASE_URL` | Connect panel / Home › Settings |
| 2 | Supabase publishable key | Yes | Yes | `SUPABASE_ANON_KEY` | Connect panel / Home › Settings |
| 3 | Gemini API key | No (enables the AI write-up) | Yes, free tier with no card | `GEMINI_API_KEY` | Home › Settings |
| 4 | Gemini model name | No | — | `GEMINI_MODEL` (default `gemini-flash-latest`) | — |
| 5 | Vercel account | For going live | Hobby is free, but only for non-commercial use | — | — |

> **Never use these in this tool:** the Supabase **secret** key (`sb_secret_…`) or the legacy **service_role** key. They bypass all security rules.

---

## 1–2. Supabase Project URL + publishable key (required)

You already have a Supabase project called **"Waysern AI Training"** (Singapore). If I set it up through the connector, I'll give you both values and you can skip to step 5.

**Steps**

1. Sign in at **https://supabase.com/dashboard** and open **Waysern AI Training**. To start fresh instead, click **New project**: give it a name, set a strong database password, choose region **Southeast Asia (Singapore)** and plan **Free**, then wait about 2 minutes.
2. Create the tables: **SQL Editor → New query →** paste all of `supabase/schema.sql` (the tool's **Copy schema.sql** button copies it) **→ Run**. You should see "Success. No rows returned".
3. **Project URL:** click **Connect** at the top of the project, or go to **Project Settings → Data API**, and copy the URL that looks like `https://abcdefgh.supabase.co`.
4. **Publishable key:** **Project Settings → API Keys →** copy the **Publishable key** (`sb_publishable_…`).
   - The older **anon** key also works, but Supabase is deprecating anon keys by the end of 2026, so use the publishable one.
5. Paste both values:
   - **Live site:** Vercel → your project → **Settings → Environment Variables** → add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (put the publishable key in this one) → redeploy.
   - **Before deploying:** paste them into the tool's **Connect your Supabase** panel and click **Test connection**.

**Free-plan limits:** a 500 MB database per project and 2 active projects. **Projects pause after 7 days without activity**; open the project in the dashboard and click *Restore* to wake it. That's plenty for three hotels' reports.

**Checklist**
- [ ] Signed in to Supabase and opened the project
- [ ] Ran `schema.sql` (or Claude ran it through the connector)
- [ ] Copied the Project URL
- [ ] Copied the **publishable** key (not the secret key)
- [ ] Added `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Vercel, or pasted them in the Connect panel
- [ ] Clicked **Test connection** and saw "Connected — 3 hotels found"

---

## 3–4. Gemini API key (optional, for the AI strategy write-up)

Without this key, the **Write strategy** button still gives you a rules-based summary. The key adds a written strategy from Google's Gemini model.

**Steps**

1. Go to **https://aistudio.google.com** and sign in with a Google account. A company account is better than a personal one.
2. Click **Get API key → Create API key**, and pick or create a Google Cloud project when asked.
3. Copy the key, which starts with `AIza…`. Treat it like a password.
4. Paste it:
   - **Live site (recommended):** Vercel → **Settings → Environment Variables** → add `GEMINI_API_KEY` → redeploy. The key then stays on the server and the browser never sees it.
   - **Demo only:** Home › Settings → paste into *Gemini API key*. It's saved in this browser only. Don't do this on a shared computer.
5. Optional: add `GEMINI_MODEL` to choose a specific model. The default, `gemini-flash-latest`, always points to Google's newest Flash model.

**Free-tier limits:** no billing account or card is needed. Google no longer publishes fixed numbers, so check your project's per-model request limits in **AI Studio → Rate limits**. A few write-ups a day across three hotels fits comfortably.

**Data note:** on the free tier, Google may use the prompts and responses to improve its products. The tool sends **only aggregated figures** (KPIs, room-type and nationality totals, competitor gaps), never guest names or booking-level rows. If even aggregated revenue data shouldn't go to Google's free tier, turn on billing in AI Studio (the paid tier isn't used for training) or leave the key out and use the rules summary.

**Checklist**
- [ ] Created the key in Google AI Studio
- [ ] Added `GEMINI_API_KEY` on Vercel (or pasted it in Settings for a quick demo)
- [ ] Home › Settings shows *Gemini API key: Found*
- [ ] **Write strategy** returned an AI write-up

---

## 5. Vercel account (to put the tool online)

**Steps**

1. Go to **https://vercel.com/signup** and sign up with **GitHub**, which makes importing the code easiest.
2. Create a **private** GitHub repo, upload the `opus-revenue-desk` folder, then in Vercel choose **Add New → Project →** import the repo (framework preset **Other**, no build command).
   - *Without GitHub:* install Node.js, open a terminal in the folder and run `npx vercel`.
3. Add the env vars from the sections above, then **Deploy**.

**Plan note:** Vercel's free **Hobby** plan is for personal, non-commercial use. That's fine for trying the demo, but a tool the hotels rely on for business needs **Vercel Pro** (from $20/month) or another host.

**Checklist**
- [ ] Vercel account created
- [ ] Project imported (GitHub) or deployed with `npx vercel`
- [ ] Env vars added: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and optionally `GEMINI_API_KEY` / `GEMINI_MODEL`
- [ ] Live URL opens, and Home › Settings shows the keys as **Found (Vercel)**

---

## Where each value ends up

```
Vercel → Settings → Environment Variables
  SUPABASE_URL        = https://<project-ref>.supabase.co      (public)
  SUPABASE_ANON_KEY   = sb_publishable_...                     (public)
  GEMINI_API_KEY      = AIza...                                (SECRET - Vercel only)
  GEMINI_MODEL        = gemini-flash-latest                    (optional)
```

`/api/config` tells the browser which of these exist and returns only the two public Supabase values. `GEMINI_API_KEY` is only ever read by `/api/ai` on the server.
