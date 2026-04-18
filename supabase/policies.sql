-- Row level security for Nexus.
-- Run AFTER schema.sql.

alter table public.users enable row level security;
alter table public.personal_arguments enable row level security;
alter table public.public_nodes enable row level security;
alter table public.agents enable row level security;
alter table public.manifesto enable row level security;

-- Users: users see their own profile; public profiles are visible to all.
drop policy if exists "users read own or public" on public.users;
create policy "users read own or public" on public.users
  for select using (auth.uid() = id or is_public = true);

drop policy if exists "users update own" on public.users;
create policy "users update own" on public.users
  for update using (auth.uid() = id);

drop policy if exists "users insert own" on public.users;
create policy "users insert own" on public.users
  for insert with check (auth.uid() = id);

-- Personal arguments: only the owner can read/write.
drop policy if exists "personal args owner rw" on public.personal_arguments;
create policy "personal args owner rw" on public.personal_arguments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Public nodes: everyone can read. Inserts/updates go through service role (API route).
drop policy if exists "public nodes read all" on public.public_nodes;
create policy "public nodes read all" on public.public_nodes
  for select using (true);

-- Agents: everyone can read agents (for debate log display).
-- Owner can soft-retract their own agent.
drop policy if exists "agents read all" on public.agents;
create policy "agents read all" on public.agents for select using (true);

drop policy if exists "agents owner update" on public.agents;
create policy "agents owner update" on public.agents
  for update using (auth.uid() = user_id);

-- Manifesto: everyone can read.
drop policy if exists "manifesto read all" on public.manifesto;
create policy "manifesto read all" on public.manifesto for select using (true);
