-- =============================================================
-- NEXO V3 — retracted_at on inferred_positions
-- Run this AFTER 20260425_nexo_v2.sql
-- =============================================================

alter table public.inferred_positions
  add column if not exists retracted_at timestamptz;

create index if not exists inferred_positions_retracted_idx
  on public.inferred_positions(retracted_at) where retracted_at is not null;
