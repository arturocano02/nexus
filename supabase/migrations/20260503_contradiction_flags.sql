-- =============================================================
-- Contradiction flags table
-- Stores pairs of inferred_positions that logically conflict.
-- Populated by POST /api/detect-contradictions.
-- Run AFTER 20260428_nexo_v5_questions.sql
-- =============================================================

create table if not exists public.contradiction_flags (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- The two conflicting positions
  position_a_id     uuid not null references public.inferred_positions(id) on delete cascade,
  position_b_id     uuid not null references public.inferred_positions(id) on delete cascade,
  -- Human-readable description of the conflict
  description       text not null,
  -- Severity: 'soft' (tension), 'hard' (direct contradiction)
  severity          text not null default 'soft' check (severity in ('soft', 'hard')),
  -- Whether the user has acknowledged / dismissed this flag
  dismissed_at      timestamptz,
  created_at        timestamptz not null default now(),
  -- Only one flag per pair (order-independent)
  constraint contradiction_flags_pair_unique unique (user_id, position_a_id, position_b_id)
);

create index if not exists contradiction_flags_user_idx
  on public.contradiction_flags(user_id);

create index if not exists contradiction_flags_position_a_idx
  on public.contradiction_flags(position_a_id);

create index if not exists contradiction_flags_position_b_idx
  on public.contradiction_flags(position_b_id);

-- RLS: users can only see and dismiss their own flags
alter table public.contradiction_flags enable row level security;

drop policy if exists "contradiction_flags_own" on public.contradiction_flags;
create policy "contradiction_flags_own" on public.contradiction_flags
  for all using (user_id = auth.uid());
