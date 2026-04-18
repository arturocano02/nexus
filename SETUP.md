# Nexus — MVP Setup Guide

This doc covers the one-time setup you need to do outside the codebase: Supabase (auth + schema + Google OAuth), Resend (email), Upstash (rate limits), admin access, Sentry, PostHog, and Vercel.

Follow the sections in order. Everything here is a real dashboard step, not a code change.

---

## 0. Environment variables

Create a `.env.local` at the repo root with the following keys. You'll fill them in as you work through this doc.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

# OpenAI (embeddings only)
OPENAI_API_KEY=

# Resend (transactional email)
RESEND_API_KEY=
RESEND_FROM_EMAIL=nexus@yourdomain.com
ADMIN_EMAIL=arturocanobusi@gmail.com

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# Sentry
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# Internal webhook secret (for /api/debate cron)
DEBATE_WEBHOOK_SECRET=

# App URL (used for email links)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

On Vercel, duplicate all of these into the project's Environment Variables panel and set a distinct set for Production vs Preview so staging doesn't write to the live database.

---

## 1. Supabase — what to update

### 1a. Run the MVP migration

Open the Supabase dashboard, pick your project, go to SQL Editor, and paste the contents of:

```
supabase/migrations/20260421_mvp_tables.sql
```

Hit Run. It's additive, so it's safe even if some tables already exist.

This adds:

- `debate_outcomes`, `notification_preferences`, `moderation_log`, `feedback`, `api_spend_log`, `api_budget`, `share_snapshots`
- New columns on `public.users`: `email`, `display_name`, `age_confirmed`, `country`, `is_admin`, `suspended`, `suspension_ends_at`, `strike_count`, `last_active_at`, `signed_up_at`, `onboarding_completed`
- An `apply_moderation_strike(user_id)` Postgres function that auto-suspends a user after 3 flags in 7 days
- A `user_impact_stats` view that the impact strip reads from
- RLS policies for every new table
- Realtime on `debate_outcomes` and `notification_preferences`

### 1b. Turn on Google OAuth

1. Supabase dashboard, Authentication → Providers → Google → toggle on.
2. In another tab, open Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID → Web application.
3. Under Authorized redirect URIs, add the Supabase callback URL shown on the Supabase Google provider page (it looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
4. Copy the Google Client ID + Client Secret back into the Supabase provider form and save.
5. On Supabase → Authentication → URL Configuration, set Site URL to `https://yourdomain.com` (or `http://localhost:3000` while developing) and add both URLs to the redirect allowlist.

### 1c. Confirm Email/Password is on

Authentication → Providers → Email. Keep "Confirm email" enabled since we want users to verify. The email verification flow itself will be handled by Resend (see section 2), not by Supabase's default sender.

Authentication → Email Templates. Leave the Supabase defaults in place for now. We override them later by using Resend directly from our own routes.

### 1d. Disable anonymous sign-ins (once real auth is in)

Authentication → Providers → Anonymous sign-ins → OFF. Do this only after the sign-up page is live so you don't lock yourself out of the local dev loop.

---

## 2. Resend — how to insert the API key

### 2a. Create the account and domain

1. Sign up at https://resend.com.
2. Domains → Add Domain → enter `yourdomain.com`.
3. Resend shows DNS records (one MX, two TXT for DKIM, and one TXT for SPF). Copy them into your DNS provider (Namecheap, Cloudflare, whoever hosts your domain).
4. Wait 5 to 30 minutes. Refresh the Resend Domains page until the status goes green.
5. Create an API key at API Keys → Create API Key. Give it full-sending permission. Copy it once, you can't read it again.

### 2b. Paste the key

Open `.env.local` and set:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=nexus@yourdomain.com
ADMIN_EMAIL=arturocanobusi@gmail.com
```

`RESEND_FROM_EMAIL` must be an address on the domain you just verified, otherwise Resend rejects the send.

Then on Vercel, add the same three keys to the project's Environment Variables. Do it for both Production and Preview.

### 2c. Local test

After the Resend lib lands in `lib/email.ts`, you can verify wiring with:

```
curl -X POST http://localhost:3000/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"to":"arturocanobusi@gmail.com"}'
```

The route will return `{ ok: true }` if the key is valid.

---

## 3. Admin dashboard — how to sign in

There is no separate admin login. The `/admin` route is gated by the `is_admin` column on `public.users`. You become an admin by:

1. Sign up normally at `/sign-up` with your real email (`arturocanobusi@gmail.com`).
2. Verify the email so the row exists in `public.users`.
3. Open the Supabase dashboard, SQL Editor, and run:

```sql
update public.users
set is_admin = true
where email = 'arturocanobusi@gmail.com';
```

4. Log out and log back in so the session token picks up the new flag.
5. Navigate to `/admin`. The page checks `is_admin` server-side. If you hit it without the flag set you'll get a 404.

To promote another admin later, run the same SQL with their email.

---

## 4. Upstash Redis — rate limiting

1. Sign up at https://console.upstash.com.
2. Create a Redis database (Global, free tier is fine).
3. Copy the REST URL and REST Token from the Details tab.
4. Paste into `.env.local`:

```
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxxxx
```

Limits we enforce (these are set in code, documented here for visibility):

- 30 chat turns per user per hour
- 5 view submissions per user per 24 hours
- 3 debate rounds per submission
- 10 moderation checks per user per hour

---

## 5. PostHog + Sentry

### 5a. PostHog

1. Sign up at https://posthog.com, create a project.
2. Project Settings → copy the Project API Key.
3. Paste:

```
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Events we track: `user_signed_up`, `first_node_created`, `views_submitted`, `debate_won`, `debate_lost`, `manifesto_viewed`, `share_map_tapped`, `notification_email_opened`, `node_clicked`, `arc_hovered`, `session_duration`.

### 5b. Sentry

1. Sign up at https://sentry.io, create a Next.js project.
2. Sentry will show a DSN that looks like `https://xxx@oyyy.ingest.sentry.io/zzz`.
3. Paste both forms:

```
SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz
NEXT_PUBLIC_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz
```

(Same value, one for the server bundle, one for the browser bundle. Only the browser one is public.)

---

## 6. Vercel deployment

1. Push the repo to GitHub.
2. On Vercel, Add New → Project → import the GitHub repo. Framework auto-detects as Next.js.
3. Environment Variables → paste every key from your `.env.local` for both Production and Preview. Use a separate Supabase project for Preview so staging doesn't touch prod data.
4. Deploy.
5. After the first deploy, set the custom domain (Settings → Domains) and point your DNS at Vercel.

`/api/health` will return `{ ok: true, ts: ... }` once the app is live. Set up an uptime monitor (BetterStack or similar) to hit it every minute.

---

## 7. Post-deploy checklist

- Sign up with Google → confirm the `public.users` row was created with `email` populated.
- Sign up with email/password → confirm the Supabase confirmation email arrives, not blocked by spam.
- Submit a view → confirm `personal_arguments` + `public_nodes` rows appear.
- Trigger a debate → confirm a row lands in `debate_outcomes` when agreement_pct shifts >10.
- Post abusive content → confirm it gets blocked by `/api/moderation/check` and appears in `moderation_log` with `is_safe = false`.
- Submit feedback from the bottom-right button → confirm the row in `feedback` and that an email lands in `ADMIN_EMAIL`.
- Visit `/admin` after running the `is_admin` SQL → confirm the dashboard renders. Visit `/admin` without the flag → confirm 404.
- Manually set `api_budget.daily_cap_usd = 0.01` → confirm new LLM calls are refused until you reset it.

If any of these fail, check the corresponding section above before opening an issue.
