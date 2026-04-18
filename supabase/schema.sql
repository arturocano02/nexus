-- Nexus schema. Run once in the Supabase SQL editor.
-- Assumes Supabase Auth is enabled and anonymous sign-ins are turned on
-- (Dashboard > Authentication > Providers > Anonymous sign-ins: ON).

-- Extensions
create extension if not exists "pgcrypto";

-- Users (profile) table. Mirrors auth.users one-to-one.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  avatar_url text,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

-- Personal arguments. The belief nodes that drive Screen 1's map.
create table if not exists public.personal_arguments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  topic_label text not null,
  summary text not null default '',
  raw_excerpts jsonb not null default '[]'::jsonb,
  confidence_score numeric(4,3) not null default 0.5,
  related_topics jsonb not null default '[]'::jsonb,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personal_arguments_user_idx on public.personal_arguments(user_id);
create index if not exists personal_arguments_topic_idx on public.personal_arguments(user_id, topic_label);

-- Public nodes. The debate nodes surfaced in the Arena.
create table if not exists public.public_nodes (
  id uuid primary key default gen_random_uuid(),
  topic_label text not null,
  consensus_summary text not null default '',
  is_resolved boolean not null default false,
  agreement_pct numeric(5,2) not null default 0,
  tension_coefficient numeric(4,3) not null default 0,
  noise_saturation numeric(4,3) not null default 0,
  debate_log jsonb not null default '[]'::jsonb,
  top_points jsonb not null default '[]'::jsonb,
  is_debating boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists public_nodes_topic_idx on public.public_nodes(topic_label);

-- Agents. An agent = a user's submitted argument set for one public node.
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  public_node_id uuid not null references public.public_nodes(id) on delete cascade,
  argument_set jsonb not null default '[]'::jsonb,
  is_anonymous boolean not null default true,
  is_active boolean not null default true,
  last_active timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists agents_node_idx on public.agents(public_node_id);
create index if not exists agents_user_idx on public.agents(user_id);

-- Manifesto. Top consensus points across the whole arena.
create table if not exists public.manifesto (
  id uuid primary key default gen_random_uuid(),
  point_text text not null unique,
  agreement_pct numeric(5,2) not null default 0,
  confidence_score numeric(4,3) not null default 0,
  source_node_id uuid references public.public_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manifesto_agreement_idx on public.manifesto(agreement_pct desc);

-- updated_at trigger helper
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

drop trigger if exists personal_arguments_touch on public.personal_arguments;
create trigger personal_arguments_touch before update on public.personal_arguments
  for each row execute procedure public.touch_updated_at();

drop trigger if exists public_nodes_touch on public.public_nodes;
create trigger public_nodes_touch before update on public.public_nodes
  for each row execute procedure public.touch_updated_at();

drop trigger if exists manifesto_touch on public.manifesto;
create trigger manifesto_touch before update on public.manifesto
  for each row execute procedure public.touch_updated_at();

-- Auto-create a public.users row when a new auth.users row appears
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.users (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable realtime on debate-critical tables
alter publication supabase_realtime add table public.public_nodes;
alter publication supabase_realtime add table public.agents;
alter publication supabase_realtime add table public.manifesto;
