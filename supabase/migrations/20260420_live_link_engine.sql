-- Live link engine + merge flow.
-- Additive migration: safe to run on top of existing schema. No drops.

-- 1. Enrich links with rendering + relationship metadata.
alter table public.links
  add column if not exists relationship_label text
    check (relationship_label in ('builds on','contradicts','clarifies','tangent','deepens','challenges')),
  add column if not exists arc_color text,
  add column if not exists arc_thickness numeric(4,3) not null default 0.5,
  add column if not exists animated_in boolean not null default false,
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists links_updated_idx on public.links(last_seen_at desc);

-- 2. Conversation volume on each personal node (drives blob size).
alter table public.personal_arguments
  add column if not exists word_count integer not null default 0;

-- 3. Permanent record of merges that were accepted at submit time.
create table if not exists public.merged_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  original_node_a_id uuid not null,
  original_node_b_id uuid not null,
  merged_node_id uuid not null,
  merged_label text not null,
  merged_summary text not null,
  top_points jsonb not null default '[]'::jsonb,
  merged_at timestamptz not null default now(),
  merged_by_user boolean not null default true
);

create index if not exists merged_nodes_user_idx on public.merged_nodes(user_id);

-- 4. Vector search scoped to one user's personal_arguments.
-- Used by the live link generator to find which of the user's existing beliefs
-- the latest statement is talking about.
create or replace function match_personal_arguments (
  p_user_id uuid,
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  topic_label text,
  summary text,
  confidence_score numeric,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    pa.id,
    pa.topic_label,
    pa.summary,
    pa.confidence_score,
    1 - (pa.embedding <=> query_embedding) as similarity
  from public.personal_arguments pa
  where pa.user_id = p_user_id
    and pa.embedding is not null
    and (1 - (pa.embedding <=> query_embedding)) > match_threshold
  order by pa.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 5. Make the links table realtime so the client sees arcs appear live.
do $$
begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='links';
  if not found then
    execute 'alter publication supabase_realtime add table public.links';
  end if;
end $$;

do $$
begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='personal_arguments';
  if not found then
    execute 'alter publication supabase_realtime add table public.personal_arguments';
  end if;
end $$;
