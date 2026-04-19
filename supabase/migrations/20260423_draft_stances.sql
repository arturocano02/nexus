-- Draft stances captured while the user chats. NEVER rolled into the
-- public aggregates (manifesto_clauses.agreement_pct / stance_count).
-- They only become "real" when the user clicks Submit, at which point we
-- copy them into user_stances. That promotion is what fires the existing
-- recompute_clause_agreement trigger and updates the public graph.
--
-- This is the layer that lets Nexus "casually ask" about a clause in
-- mid-conversation: we can record a provisional for / against / skip
-- without disturbing anyone else's view of consensus until the user has
-- reviewed and submitted.
--
-- Additive. Safe to run on top of prior migrations. No drops.

-- =========================================================
-- 1. DRAFT STANCES.
-- =========================================================
create table if not exists public.draft_stances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  clause_id uuid not null references public.manifesto_clauses(id) on delete cascade,
  stance text not null check (stance in ('for','against','skip')),
  -- Optional "why" line. When the user only said "yes" we may have no
  -- reasoning; when Nexus inferred the stance from a longer monologue we
  -- usually do.
  reasoning text,
  -- 0..1 confidence that the inferred stance reflects what the user meant.
  -- Low confidence = ask to confirm on the submit screen.
  confidence numeric(4,3) not null default 0.5,
  -- How the draft got here:
  --  'direct'    user typed/clicked for/against on this exact clause
  --  'inferred'  model read it off a wider user statement
  --  'prompt'    user answered a follow-up question Nexus asked about it
  source text not null default 'inferred' check (source in ('direct','inferred','prompt')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, clause_id)
);

create index if not exists draft_stances_user_idx on public.draft_stances(user_id);
create index if not exists draft_stances_clause_idx on public.draft_stances(clause_id);

drop trigger if exists draft_stances_touch on public.draft_stances;
create trigger draft_stances_touch before update on public.draft_stances
  for each row execute procedure public.touch_updated_at();

-- =========================================================
-- 2. PROMOTE: drafts -> user_stances. Called by /api/stances/submit
-- and /api/simulate. Idempotent (can be called twice safely).
-- The insert fires the existing on_stance_change trigger which then
-- recomputes manifesto_clauses.agreement_pct. That is the only place
-- the public graph is allowed to move.
-- =========================================================
create or replace function public.promote_draft_stances(
  p_user_id uuid,
  p_simulated boolean default false
)
returns integer
language plpgsql
security definer
as $fn$
declare
  promoted integer := 0;
begin
  insert into public.user_stances (user_id, clause_id, stance, reasoning, is_simulated)
  select user_id, clause_id, stance, reasoning, p_simulated
  from public.draft_stances
  where user_id = p_user_id
  on conflict (user_id, clause_id) do update set
    stance = excluded.stance,
    reasoning = excluded.reasoning,
    is_simulated = excluded.is_simulated;

  get diagnostics promoted = row_count;
  delete from public.draft_stances where user_id = p_user_id;
  return promoted;
end
$fn$;

-- =========================================================
-- 3. GROUPED ARGUMENTS VIEW: the "arguments tracked and grouped" output.
-- Any row in user_stances with a non-empty reasoning is an argument.
-- Callers typically filter by clause_id + stance and order by created_at.
-- =========================================================
create or replace view public.clause_arguments as
select
  s.clause_id,
  s.stance,
  s.reasoning,
  s.user_id,
  s.is_simulated,
  s.created_at
from public.user_stances s
where s.reasoning is not null
  and length(trim(s.reasoning)) > 0;

-- =========================================================
-- 4. RLS.
-- =========================================================
alter table public.draft_stances enable row level security;

drop policy if exists "draft_stances owner rw" on public.draft_stances;
create policy "draft_stances owner rw" on public.draft_stances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- 5. REALTIME. Draft stances are per-user-private, no need to broadcast
-- them. user_stances is already on the publication from migration 0422,
-- so the graph gets its updates from there.
-- =========================================================
