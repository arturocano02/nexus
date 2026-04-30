-- =============================================================
-- NEXUS Auth System — profiles, user_views, auth_events
-- Run this AFTER 20260428_nexo_v5_questions.sql
-- =============================================================

-- ---------------------------------------------------------------
-- 1. profiles table — extends auth.users
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  display_name  text not null,
  age           integer not null check (age >= 16 and age <= 120),
  country       text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ---------------------------------------------------------------
-- 2. user_views table — persistent political view records
-- ---------------------------------------------------------------
create table if not exists public.user_views (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  topic_label         text not null,
  summary             text not null default '',
  confidence_score    float not null default 0.5 check (confidence_score >= 0 and confidence_score <= 1),
  raw_excerpts        jsonb not null default '[]'::jsonb,
  submitted_to_arena  boolean not null default false,
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  is_deleted          boolean not null default false
);

alter table public.user_views enable row level security;

-- Users can read their own non-deleted views
create policy "user_views_select_own" on public.user_views
  for select using (auth.uid() = user_id);

-- Users can insert their own views
create policy "user_views_insert_own" on public.user_views
  for insert with check (auth.uid() = user_id);

-- Users can update only non-submitted views (submitted = read-only)
create policy "user_views_update_own_unsubmitted" on public.user_views
  for update using (auth.uid() = user_id and submitted_to_arena = false);

-- Unique constraint: one view per user+topic
create unique index if not exists user_views_user_topic_idx
  on public.user_views (user_id, topic_label)
  where is_deleted = false;

-- ---------------------------------------------------------------
-- 3. auth_events table — audit log for admin dashboard
-- ---------------------------------------------------------------
create table if not exists public.auth_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  event_type  text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

alter table public.auth_events enable row level security;

-- No user-facing access; only service role writes/reads
create policy "auth_events_deny_all" on public.auth_events
  using (false);

-- ---------------------------------------------------------------
-- 4. Backfill personal_arguments.user_id if missing
--    (already exists per schema.sql — this is a safe no-op)
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'personal_arguments'
      and column_name = 'user_id'
  ) then
    alter table public.personal_arguments
      add column user_id uuid references auth.users(id) on delete set null;
  end if;
end$$;

-- ---------------------------------------------------------------
-- 5. updated_at trigger function (idempotent)
-- ---------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_views_set_updated_at on public.user_views;
create trigger user_views_set_updated_at
  before update on public.user_views
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- 6. Storage bucket for avatars (must be created via dashboard
--    or the storage API — SQL cannot create buckets directly)
-- ---------------------------------------------------------------
-- Run in Supabase Dashboard > Storage: create bucket "avatars" (public)
-- or via: INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- Storage RLS: users can upload their own avatar
create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars_select_public" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
