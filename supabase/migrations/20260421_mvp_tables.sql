-- MVP tables + user extensions.
-- Additive. Safe to run on top of prior migrations. No drops.
-- Paste this whole file into the Supabase SQL editor and hit Run.

-- =========================================================
-- 1. USERS: extend the profile table with auth + moderation fields.
-- =========================================================
alter table public.users
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists age_confirmed boolean not null default false,
  add column if not exists country text,
  add column if not exists is_admin boolean not null default false,
  add column if not exists suspended boolean not null default false,
  add column if not exists suspension_ends_at timestamptz,
  add column if not exists strike_count integer not null default 0,
  add column if not exists last_active_at timestamptz not null default now(),
  add column if not exists signed_up_at timestamptz not null default now(),
  add column if not exists onboarding_completed boolean not null default false;

create index if not exists users_email_idx on public.users(email);
create index if not exists users_last_active_idx on public.users(last_active_at desc);
create index if not exists users_admin_idx on public.users(is_admin) where is_admin = true;

-- Keep public.users.email in sync with auth.users.email on insert.
-- Avoids needing to pass email separately from the sign-up form.
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.users (id, email)
    values (new.id, new.email)
    on conflict (id) do update set email = excluded.email;
  return new;
end $$ language plpgsql security definer;

-- =========================================================
-- 2. DEBATE OUTCOMES: win/loss record per finished debate.
-- Used by the impact strip (Debates / Wins / Reach).
-- =========================================================
create table if not exists public.debate_outcomes (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.public_nodes(id) on delete cascade,
  agent_a_id uuid references public.agents(id) on delete set null,
  agent_b_id uuid references public.agents(id) on delete set null,
  -- winner_agent_id is null when the outcome is a draw/inconclusive.
  winner_agent_id uuid references public.agents(id) on delete set null,
  outcome text not null check (outcome in ('win','loss','draw','inconclusive')),
  agreement_pct_before numeric(5,2) not null,
  agreement_pct_after numeric(5,2) not null,
  -- Shift > 10 points triggers a win/loss record; anything else is 'draw'.
  shift numeric(5,2) generated always as (agreement_pct_after - agreement_pct_before) stored,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists debate_outcomes_node_idx on public.debate_outcomes(node_id);
create index if not exists debate_outcomes_winner_idx on public.debate_outcomes(winner_agent_id);
create index if not exists debate_outcomes_created_idx on public.debate_outcomes(created_at desc);

-- Per-user quick aggregates for the impact strip. Kept as a view so we never
-- drift out of sync with the outcomes table.
create or replace view public.user_impact_stats as
select
  u.id as user_id,
  coalesce(sum(case when do2.outcome in ('win','loss') then 1 else 0 end), 0) as debates,
  coalesce(sum(case when do2.outcome = 'win' then 1 else 0 end), 0) as wins,
  coalesce(sum(case when do2.outcome = 'loss' then 1 else 0 end), 0) as losses,
  coalesce(sum(case when do2.outcome = 'win' then 1 else 0 end), 0) * 100 as reach_estimate
from public.users u
  left join public.agents a on a.user_id = u.id
  left join public.debate_outcomes do2
    on (do2.agent_a_id = a.id or do2.agent_b_id = a.id)
group by u.id;

-- =========================================================
-- 3. NOTIFICATION PREFERENCES: per-user email opt-ins.
-- =========================================================
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  debate_results boolean not null default true,
  impact_milestones boolean not null default true,
  weekly_digest boolean not null default true,
  manifesto_shift boolean not null default true,
  last_weekly_digest_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute procedure public.touch_updated_at();

-- Seed a preferences row whenever a user row is created so the app can
-- read preferences without a fallback branch.
create or replace function public.seed_notification_prefs() returns trigger as $$
begin
  insert into public.notification_preferences (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end $$ language plpgsql security definer;

drop trigger if exists on_user_created_seed_prefs on public.users;
create trigger on_user_created_seed_prefs
  after insert on public.users
  for each row execute procedure public.seed_notification_prefs();

-- =========================================================
-- 4. MODERATION LOG: every auto-scan result that wasn't "safe".
-- Three flags in 7 days drives strike_count to a suspension.
-- =========================================================
create table if not exists public.moderation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  content text not null,
  source text not null check (source in ('chat','submit','debate','feedback','other')),
  category text,
  is_safe boolean not null,
  reason text,
  model_name text,
  reviewed_by_admin boolean not null default false,
  admin_override boolean,
  created_at timestamptz not null default now()
);

create index if not exists moderation_log_user_idx on public.moderation_log(user_id);
create index if not exists moderation_log_unsafe_idx on public.moderation_log(created_at desc) where is_safe = false;

-- =========================================================
-- 5. FEEDBACK: the bottom-right feedback button writes here.
-- =========================================================
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('bug','idea','other')),
  body text not null,
  screenshot_url text,
  -- Captures which screen/route the feedback came from.
  context jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback(created_at desc);
create index if not exists feedback_unresolved_idx on public.feedback(created_at desc) where resolved = false;

-- =========================================================
-- 6. API SPEND LOG: one row per Anthropic/OpenAI call for the cost monitor.
-- Complements debate_token_log (which only covers debate rounds).
-- =========================================================
create table if not exists public.api_spend_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  provider text not null check (provider in ('anthropic','openai','resend','other')),
  route text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- cost_usd kept explicit so we can set a hard cap without re-deriving rates.
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists api_spend_log_created_idx on public.api_spend_log(created_at desc);
create index if not exists api_spend_log_provider_idx on public.api_spend_log(provider, created_at desc);

-- Hard spending cap per day. Read from the admin dashboard and enforced in
-- middleware: if today's spend > cap, new LLM calls are refused.
create table if not exists public.api_budget (
  id int primary key default 1 check (id = 1),
  daily_cap_usd numeric(10,2) not null default 25.00,
  month_cap_usd numeric(10,2) not null default 250.00,
  updated_at timestamptz not null default now()
);
insert into public.api_budget (id) values (1) on conflict (id) do nothing;

-- =========================================================
-- 7. SHARE SNAPSHOTS: PNG data-url + caption for the Share Map viral loop.
-- =========================================================
create table if not exists public.share_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  image_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists share_snapshots_user_idx on public.share_snapshots(user_id, created_at desc);

-- =========================================================
-- 8. RLS POLICIES.
-- =========================================================
alter table public.debate_outcomes enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.moderation_log enable row level security;
alter table public.feedback enable row level security;
alter table public.api_spend_log enable row level security;
alter table public.api_budget enable row level security;
alter table public.share_snapshots enable row level security;

-- Debate outcomes: public read, writes go through the service role.
drop policy if exists "debate_outcomes read all" on public.debate_outcomes;
create policy "debate_outcomes read all" on public.debate_outcomes
  for select using (true);

-- Notification prefs: each user reads/writes their own row.
drop policy if exists "notif_prefs owner rw" on public.notification_preferences;
create policy "notif_prefs owner rw" on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Moderation log: only the owner and admins can read. Writes are service-role.
drop policy if exists "moderation_log owner or admin read" on public.moderation_log;
create policy "moderation_log owner or admin read" on public.moderation_log
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

-- Feedback: users can insert their own. Read limited to admin + owner.
drop policy if exists "feedback owner insert" on public.feedback;
create policy "feedback owner insert" on public.feedback
  for insert with check (auth.uid() = user_id or user_id is null);

drop policy if exists "feedback owner or admin read" on public.feedback;
create policy "feedback owner or admin read" on public.feedback
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

-- Spend log + budget: admin-only read. Writes service-role.
drop policy if exists "api_spend admin read" on public.api_spend_log;
create policy "api_spend admin read" on public.api_spend_log
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

drop policy if exists "api_budget admin read" on public.api_budget;
create policy "api_budget admin read" on public.api_budget
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

drop policy if exists "api_budget admin write" on public.api_budget;
create policy "api_budget admin write" on public.api_budget
  for update using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

-- Share snapshots: owner reads/writes.
drop policy if exists "share_snapshots owner rw" on public.share_snapshots;
create policy "share_snapshots owner rw" on public.share_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- 9. ADMIN-ONLY UPDATE HELPERS on users table.
-- Admins need to be able to suspend or promote other users.
-- =========================================================
drop policy if exists "users admin update" on public.users;
create policy "users admin update" on public.users
  for update using (
    auth.uid() = id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

-- =========================================================
-- 10. REALTIME on the strip's live tables.
-- =========================================================
do $$
begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='debate_outcomes';
  if not found then execute 'alter publication supabase_realtime add table public.debate_outcomes'; end if;
end $$;

do $$
begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notification_preferences';
  if not found then execute 'alter publication supabase_realtime add table public.notification_preferences'; end if;
end $$;

-- =========================================================
-- 11. STRIKE -> SUSPENSION helper.
-- Call from the API after a moderation flag is recorded.
-- Named dollar-quote + join rewrite avoids a Supabase SQL editor parser
-- quirk where a DECLARE block inside $$ ... $$ can be mis-read as a
-- top-level cursor declaration.
-- =========================================================
create or replace function public.apply_moderation_strike(p_user_id uuid)
returns void
language plpgsql
security definer
as $fn$
begin
  update public.users u
    set strike_count = sub.cnt,
        suspended = (sub.cnt >= 3),
        suspension_ends_at = case
          when sub.cnt >= 3 then now() + interval '7 days'
          else u.suspension_ends_at
        end
    from (
      select count(*)::integer as cnt
      from public.moderation_log
      where user_id = p_user_id
        and is_safe = false
        and created_at > now() - interval '7 days'
    ) as sub
    where u.id = p_user_id;
end
$fn$;
