-- =============================================================
-- NEXUS Advisor System — unified conversations + advisor_name
-- Run AFTER 20260430_auth_system.sql
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Add advisor_name to profiles
-- ---------------------------------------------------------------
alter table public.profiles
  add column if not exists advisor_name text;

-- ---------------------------------------------------------------
-- 2. conversations table — one row per user, messages as jsonb array
--    Each message: { role, content, topic_tags, belief_updates, timestamp }
-- ---------------------------------------------------------------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique not null references public.profiles(id) on delete cascade,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.conversations enable row level security;

create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);

create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);

create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();
