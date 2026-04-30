-- =============================================================
-- NEXO V5 — questions table (binary decision tree)
-- Represents the full L1-L5 branching taxonomy from the doc.
-- Run this AFTER 20260427_nexo_v4.sql
-- =============================================================

-- ---------------------------------------------------------------
-- 1. questions table
--    Each row is one node in a binary question tree.
--    Root nodes (layer = 1) have no parent.
--    All other nodes have parent_question_id + parent_answer.
-- ---------------------------------------------------------------
create table if not exists public.questions (
  id                  uuid primary key default gen_random_uuid(),
  category_id         uuid not null references public.taxonomy_categories(id) on delete cascade,
  subtopic_id         uuid references public.taxonomy_subtopics(id) on delete set null,
  parent_question_id  uuid references public.questions(id) on delete cascade,
  -- 'yes' or 'no' — which branch from the parent leads here. null on root.
  parent_answer       text check (parent_answer in ('yes', 'no')),
  layer               int not null check (layer between 1 and 5),
  question_text       text not null,
  -- ⚡ tension questions: force the user to confront a contradiction in their values
  is_tension          boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint questions_root_or_child check (
    (parent_question_id is null and parent_answer is null)
    or (parent_question_id is not null and parent_answer is not null)
  )
);

create index if not exists questions_category_idx   on public.questions(category_id);
create index if not exists questions_subtopic_idx   on public.questions(subtopic_id);
create index if not exists questions_parent_idx     on public.questions(parent_question_id);
create index if not exists questions_layer_idx      on public.questions(layer);

-- ---------------------------------------------------------------
-- 2. Wire inferred_positions to the new questions table
--    Nullable so existing rows don't break.
-- ---------------------------------------------------------------
alter table public.inferred_positions
  add column if not exists question_id uuid references public.questions(id) on delete set null;

create index if not exists inferred_positions_question_idx
  on public.inferred_positions(question_id);

-- ---------------------------------------------------------------
-- 3. RLS — questions are public-read, service-role writes
-- ---------------------------------------------------------------
alter table public.questions enable row level security;

drop policy if exists "questions read all" on public.questions;
create policy "questions read all" on public.questions
  for select using (true);

-- ---------------------------------------------------------------
-- 4. Realtime — so the app can react if question trees change
-- ---------------------------------------------------------------
do $$
begin
  perform 1 from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'questions';
  if not found then
    execute 'alter publication supabase_realtime add table public.questions';
  end if;
end $$;
