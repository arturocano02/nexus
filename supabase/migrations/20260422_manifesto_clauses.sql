-- Layered manifesto explorer: Categories -> Clauses -> Stances.
-- Pivot away from AI-vs-AI debates. Agreement emerges from real user stances.
-- Additive. Safe to run on top of prior migrations. No drops.

-- =========================================================
-- 1. CATEGORIES (top-level sections like "Immigration").
-- =========================================================
create table if not exists public.manifesto_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  blurb text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists manifesto_categories_sort_idx on public.manifesto_categories(sort_order);

-- =========================================================
-- 2. CLAUSES (statements people take a stance on).
-- Each clause sits inside a section (e.g. "Border and enforcement")
-- which groups related statements inside a category.
-- =========================================================
create table if not exists public.manifesto_clauses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.manifesto_categories(id) on delete cascade,
  section text not null,
  statement text not null,
  -- Short reasoning hints shown in the FOR / AGAINST chips. Overwritten when
  -- real user stances carry their own reasoning.
  for_argument text,
  against_argument text,
  agreement_pct numeric(5,2) not null default 50.00,
  stance_count integer not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manifesto_clauses_category_idx on public.manifesto_clauses(category_id, sort_order);
create index if not exists manifesto_clauses_active_idx on public.manifesto_clauses(is_active) where is_active = true;

drop trigger if exists manifesto_clauses_touch on public.manifesto_clauses;
create trigger manifesto_clauses_touch before update on public.manifesto_clauses
  for each row execute procedure public.touch_updated_at();

-- =========================================================
-- 3. USER STANCES (for / against / skip + optional reasoning).
-- Only gets written when a user clicks Submit (never mid-chat).
-- =========================================================
create table if not exists public.user_stances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  clause_id uuid not null references public.manifesto_clauses(id) on delete cascade,
  stance text not null check (stance in ('for','against','skip')),
  -- Optional free-form "why". Powers the expandable arguments list.
  reasoning text,
  -- Flag set by the simulator so real analytics can exclude fake stances.
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, clause_id)
);

create index if not exists user_stances_clause_idx on public.user_stances(clause_id);
create index if not exists user_stances_user_idx on public.user_stances(user_id);

drop trigger if exists user_stances_touch on public.user_stances;
create trigger user_stances_touch before update on public.user_stances
  for each row execute procedure public.touch_updated_at();

-- =========================================================
-- 4. AGGREGATE FUNCTION: recompute agreement_pct for a clause.
-- Called after any stance insert/update. "Agreement" here means
-- share of non-skip stances that chose 'for'.
-- =========================================================
create or replace function public.recompute_clause_agreement(p_clause_id uuid)
returns void
language plpgsql
security definer
as $fn$
begin
  update public.manifesto_clauses c
    set agreement_pct = case when sub.total > 0 then (sub.fors::numeric * 100 / sub.total) else 50 end,
        stance_count = coalesce(sub.total, 0) + coalesce(sub.skips, 0)
    from (
      select
        count(*) filter (where stance = 'for') as fors,
        count(*) filter (where stance = 'against') as againsts,
        count(*) filter (where stance in ('for','against')) as total,
        count(*) filter (where stance = 'skip') as skips
      from public.user_stances
      where clause_id = p_clause_id
    ) sub
    where c.id = p_clause_id;
end
$fn$;

-- Recompute automatically whenever a stance changes.
create or replace function public.on_stance_change() returns trigger as $$
begin
  perform public.recompute_clause_agreement(coalesce(new.clause_id, old.clause_id));
  return coalesce(new, old);
end $$ language plpgsql security definer;

drop trigger if exists user_stances_recompute on public.user_stances;
create trigger user_stances_recompute
  after insert or update or delete on public.user_stances
  for each row execute procedure public.on_stance_change();

-- =========================================================
-- 5. EXPLORER VIEW: single query the UI needs.
-- Produces the expandable structure in one round-trip.
-- =========================================================
create or replace view public.manifesto_explorer as
select
  cat.id as category_id,
  cat.slug as category_slug,
  cat.title as category_title,
  cat.blurb as category_blurb,
  cat.sort_order as category_sort,
  cl.id as clause_id,
  cl.section,
  cl.statement,
  cl.for_argument,
  cl.against_argument,
  cl.agreement_pct,
  cl.stance_count,
  cl.sort_order as clause_sort
from public.manifesto_categories cat
  left join public.manifesto_clauses cl on cl.category_id = cat.id and cl.is_active = true
order by cat.sort_order, cl.sort_order;

-- =========================================================
-- 6. RLS.
-- =========================================================
alter table public.manifesto_categories enable row level security;
alter table public.manifesto_clauses enable row level security;
alter table public.user_stances enable row level security;

drop policy if exists "manifesto_categories read all" on public.manifesto_categories;
create policy "manifesto_categories read all" on public.manifesto_categories
  for select using (true);

drop policy if exists "manifesto_clauses read all" on public.manifesto_clauses;
create policy "manifesto_clauses read all" on public.manifesto_clauses
  for select using (true);

drop policy if exists "user_stances read all" on public.user_stances;
create policy "user_stances read all" on public.user_stances
  for select using (true);

drop policy if exists "user_stances owner write" on public.user_stances;
create policy "user_stances owner write" on public.user_stances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- 7. REALTIME.
-- =========================================================
do $$
begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='manifesto_clauses';
  if not found then execute 'alter publication supabase_realtime add table public.manifesto_clauses'; end if;
end $$;

do $$
begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_stances';
  if not found then execute 'alter publication supabase_realtime add table public.user_stances'; end if;
end $$;

-- =========================================================
-- 8. SEED: Immigration topic (matches the reference design).
-- =========================================================
insert into public.manifesto_categories (slug, title, blurb, sort_order)
values
  ('immigration', 'Immigration', 'How arrivals, rights, and integration should be handled.', 1)
on conflict (slug) do update set title = excluded.title, blurb = excluded.blurb, sort_order = excluded.sort_order;

with cat as (select id from public.manifesto_categories where slug = 'immigration')
insert into public.manifesto_clauses
  (category_id, section, statement, for_argument, against_argument, sort_order)
select cat.id, v.section, v.statement, v.for_arg, v.against_arg, v.sort_order
from cat, (values
  (
    'Border and enforcement',
    'A functioning, enforceable border system that processes arrivals lawfully, humanely, and with reasonable speed.',
    'A broken system hurts everyone, claimants face years of limbo and the state loses control of numbers.',
    'Who defines "enforceable"? Historically it means detention and deportation used as political cover.',
    1
  ),
  (
    'Border and enforcement',
    'Asylum claims should be fully adjudicated within six months, with legal support provided to all claimants.',
    'Multi-year backlogs are inhumane and create incentives for people to remain unlawfully.',
    'Complex cases cannot be decided in 6 months without compromising the quality of decisions.',
    2
  ),
  (
    'Economic migration',
    'Work visas should be tied to shortage occupations so migration tracks real labour demand.',
    'Shortage-linked visas fill gaps the domestic workforce cannot cover in time.',
    'Shortage lists lag reality and lock in low-wage industries instead of training locals.',
    3
  ),
  (
    'Economic migration',
    'Employers who sponsor a visa should be legally accountable for wages, housing conditions, and exit rights.',
    'Without employer accountability, sponsorship becomes a tool for exploitation.',
    'Heavy sponsor liabilities discourage small firms from hiring migrants at all.',
    4
  ),
  (
    'Integration and rights',
    'Permanent residents should have the same access to healthcare, schooling, and in-work benefits as citizens.',
    'Equal access reduces the underclass effect and speeds up integration.',
    'Full parity before citizenship removes a meaningful incentive to naturalise.',
    5
  ),
  (
    'Integration and rights',
    'Undocumented residents of 10+ years should have a clear, paid pathway to legal status.',
    'People rooted in the country for a decade cannot be meaningfully removed, legalising them ends the shadow economy.',
    'A path to status rewards rule-breaking and undermines those who followed the legal route.',
    6
  ),
  (
    'Housing and infrastructure',
    'Central government should fund extra housing and school places in councils that take above-average numbers of new arrivals.',
    'Local services collapse without funding that actually follows the population.',
    'Ring-fenced migration funding creates perverse incentives and bureaucratic overhead.',
    7
  )
) as v(section, statement, for_arg, against_arg, sort_order)
on conflict do nothing;
