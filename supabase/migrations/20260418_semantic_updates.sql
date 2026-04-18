-- 1. Enable pgvector
create extension if not exists vector;

-- 2. Add embedding columns
alter table public.personal_arguments 
add column if not exists embedding vector(1536);

alter table public.public_nodes 
add column if not exists embedding vector(1536),
add column if not exists merged_from jsonb default '[]'::jsonb;

-- 3. Create links table
create table if not exists public.links (
    id uuid primary key default gen_random_uuid(),
    node_a_id uuid not null,
    node_b_id uuid not null,
    similarity_score numeric(4,3) not null,
    particle_direction text check (particle_direction in ('a_to_b', 'b_to_a')),
    link_summary text,
    is_user_confirmed boolean not null default false,
    created_at timestamptz not null default now()
);

-- Index for fast link lookups
create index if not exists links_a_idx on public.links(node_a_id);
create index if not exists links_b_idx on public.links(node_b_id);

-- 4. Create debate_token_log table
create table if not exists public.debate_token_log (
    id uuid primary key default gen_random_uuid(),
    node_id uuid references public.public_nodes(id) on delete set null,
    tokens_used integer not null,
    round_number integer not null,
    created_at timestamptz not null default now()
);

-- 5. Vector similarity search function
create or replace function match_nodes (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  exclude_node_id uuid default null
)
returns table (
  id uuid,
  topic_label text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    public_nodes.id,
    public_nodes.topic_label,
    1 - (public_nodes.embedding <=> query_embedding) as similarity
  from public_nodes
  where (1 - (public_nodes.embedding <=> query_embedding)) > match_threshold
    and (exclude_node_id is null or public_nodes.id != exclude_node_id)
  order by public_nodes.embedding <=> query_embedding
  limit match_count;
end;
$$;
