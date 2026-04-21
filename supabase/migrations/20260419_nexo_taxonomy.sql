-- =============================================================
-- NEXO REBUILD — taxonomy + conversations
-- Run this in the Supabase SQL editor.
-- Drops the old fake-data / debate-era tables then creates the
-- new taxonomy tree (categories → subtopics → questions) and the
-- conversations table that drives weighting + aggregation.
-- =============================================================

-- ---------------------------------------------------------------
-- 0. DROP OLD TABLES (cascade handles FK children automatically)
-- ---------------------------------------------------------------
drop table if exists public.draft_stances         cascade;
drop table if exists public.user_stances          cascade;
drop table if exists public.manifesto_clauses     cascade;
drop table if exists public.manifesto_categories  cascade;
drop table if exists public.debate_outcomes       cascade;
drop table if exists public.agents                cascade;
drop table if exists public.manifesto             cascade;
drop table if exists public.public_nodes          cascade;
drop view  if exists public.manifesto_explorer    cascade;
drop view  if exists public.clause_arguments      cascade;

-- Drop old functions that referenced dropped tables
drop function if exists public.promote_draft_stances(uuid, boolean) cascade;
drop function if exists public.recompute_clause_agreement(uuid)      cascade;
drop function if exists public.on_stance_change()                    cascade;

-- Clear old personal data so the app starts clean
truncate public.personal_arguments restart identity cascade;
truncate public.links              restart identity cascade;
truncate public.merged_nodes       restart identity cascade;

-- ---------------------------------------------------------------
-- 1. TAXONOMY TABLES
-- ---------------------------------------------------------------

create table if not exists public.taxonomy_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists taxonomy_categories_sort_idx
  on public.taxonomy_categories(sort_order);

create table if not exists public.taxonomy_subtopics (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.taxonomy_categories(id) on delete cascade,
  slug        text not null,
  name        text not null,
  is_other    boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (category_id, slug)
);

create index if not exists taxonomy_subtopics_category_idx
  on public.taxonomy_subtopics(category_id, sort_order);

create table if not exists public.taxonomy_questions (
  id           uuid primary key default gen_random_uuid(),
  subtopic_id  uuid not null references public.taxonomy_subtopics(id) on delete cascade,
  depth_layer  integer not null check (depth_layer in (1, 2, 3)),
  question_text text not null,
  -- yes / no branches (nullable – linear for MVP, branching added later)
  yes_next_id  uuid references public.taxonomy_questions(id),
  no_next_id   uuid references public.taxonomy_questions(id),
  created_at   timestamptz not null default now()
);

create index if not exists taxonomy_questions_subtopic_idx
  on public.taxonomy_questions(subtopic_id, depth_layer);

-- ---------------------------------------------------------------
-- 2. CONVERSATIONS TABLE
-- One row per question answered per session.
-- ---------------------------------------------------------------

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  session_id      text not null,
  category_id     uuid references public.taxonomy_categories(id),
  subtopic_id     uuid references public.taxonomy_subtopics(id),
  question_text   text,           -- stored verbatim (may be AI-generated at L2/L3)
  question_depth  integer not null default 1 check (question_depth in (1, 2, 3)),
  stance          text check (stance in ('yes', 'no', 'abstain', 'unclear')),
  arguments_json  jsonb not null default '[]'::jsonb,
  -- Weight components (computed at submit time)
  weight_d        numeric(5,3),
  weight_q        numeric(5,3),
  weight_c        numeric(5,3),
  weight_total    numeric(5,3),
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists conversations_user_idx
  on public.conversations(user_id);
create index if not exists conversations_session_idx
  on public.conversations(session_id);
create index if not exists conversations_category_idx
  on public.conversations(category_id);
create index if not exists conversations_submitted_idx
  on public.conversations(submitted_at) where submitted_at is not null;
create index if not exists conversations_subtopic_idx
  on public.conversations(subtopic_id);

drop trigger if exists conversations_touch on public.conversations;
create trigger conversations_touch
  before update on public.conversations
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------

alter table public.taxonomy_categories enable row level security;
alter table public.taxonomy_subtopics  enable row level security;
alter table public.taxonomy_questions  enable row level security;
alter table public.conversations       enable row level security;

-- Taxonomy is public-read (no auth required)
drop policy if exists "taxonomy_categories read all" on public.taxonomy_categories;
create policy "taxonomy_categories read all" on public.taxonomy_categories
  for select using (true);

drop policy if exists "taxonomy_subtopics read all" on public.taxonomy_subtopics;
create policy "taxonomy_subtopics read all" on public.taxonomy_subtopics
  for select using (true);

drop policy if exists "taxonomy_questions read all" on public.taxonomy_questions;
create policy "taxonomy_questions read all" on public.taxonomy_questions
  for select using (true);

-- Conversations: owner reads/writes their own rows
drop policy if exists "conversations owner rw" on public.conversations;
create policy "conversations owner rw" on public.conversations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 4. REALTIME
-- ---------------------------------------------------------------

do $$
begin
  perform 1 from pg_publication_tables
    where pubname='supabase_realtime' and tablename='conversations';
  if not found then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;
end $$;

-- ---------------------------------------------------------------
-- 5. SEED — categories
-- ---------------------------------------------------------------

insert into public.taxonomy_categories (slug, name, sort_order)
values
  ('immigration',          'Immigration',                 1),
  ('economy',              'Economy',                     2),
  ('housing',              'Housing',                     3),
  ('healthcare',           'Healthcare',                  4),
  ('climate',              'Climate and environment',     5),
  ('defence',              'Defence and foreign affairs', 6),
  ('education',            'Education',                   7),
  ('technology',           'Technology and AI',           8)
on conflict (slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------
-- 6. SEED — subtopics (4 named + 1 Other per category)
-- ---------------------------------------------------------------

-- IMMIGRATION
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('labour-market',         'Labour market effects',    false, 1),
  ('public-services',       'Public services capacity', false, 2),
  ('cultural-integration',  'Cultural integration',     false, 3),
  ('border-security',       'Border security',          false, 4),
  ('other',                 'Other',                    true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'immigration'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- ECONOMY
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('taxation',       'Taxation and redistribution', false, 1),
  ('trade',          'Trade and globalisation',     false, 2),
  ('employment',     'Employment and wages',        false, 3),
  ('public-debt',    'Public debt',                 false, 4),
  ('other',          'Other',                       true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'economy'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- HOUSING
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('planning',       'Planning and development', false, 1),
  ('affordability',  'Affordability and rents',  false, 2),
  ('social-housing', 'Social housing',           false, 3),
  ('land-ownership', 'Land ownership',           false, 4),
  ('other',          'Other',                    true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'housing'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- HEALTHCARE
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('nhs-funding',     'NHS funding and capacity',    false, 1),
  ('mental-health',   'Mental health provision',     false, 2),
  ('preventative',    'Preventative care',           false, 3),
  ('pharmaceuticals', 'Pharmaceutical regulation',  false, 4),
  ('other',           'Other',                       true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'healthcare'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- CLIMATE
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('net-zero',            'Net zero targets',             false, 1),
  ('energy-transition',   'Energy transition',            false, 2),
  ('env-regulation',      'Environmental regulation',     false, 3),
  ('adaptation',          'Adaptation and resilience',    false, 4),
  ('other',               'Other',                        true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'climate'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- DEFENCE
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('nato',           'NATO and alliances',      false, 1),
  ('nuclear',        'Nuclear deterrence',      false, 2),
  ('foreign-aid',    'Foreign aid',             false, 3),
  ('trade-diplomacy','Trade diplomacy',         false, 4),
  ('other',          'Other',                   true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'defence'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- EDUCATION
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('school-funding', 'School funding',              false, 1),
  ('curriculum',     'Curriculum and standards',    false, 2),
  ('higher-ed',      'Higher education',            false, 3),
  ('skills',         'Skills and apprenticeships',  false, 4),
  ('other',          'Other',                       true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'education'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- TECHNOLOGY
insert into public.taxonomy_subtopics (category_id, slug, name, is_other, sort_order)
select c.id, v.slug, v.name, v.is_other, v.sort_order
from public.taxonomy_categories c
cross join (values
  ('ai-safety',        'AI safety rules',          false, 1),
  ('data-privacy',     'Data privacy',             false, 2),
  ('big-tech',         'Big tech regulation',      false, 3),
  ('digital-infra',    'Digital infrastructure',   false, 4),
  ('other',            'Other',                    true,  5)
) as v(slug, name, is_other, sort_order)
where c.slug = 'technology'
on conflict (category_id, slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------
-- 7. SEED — questions (3 depth layers per named subtopic)
-- ---------------------------------------------------------------

-- Helper: insert 3 questions for a given subtopic identified by
-- (category_slug, subtopic_slug).

-- IMMIGRATION > Labour market effects
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'immigration' and t.slug = 'labour-market'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think immigration is putting pressure on jobs or wages for UK workers?'),
  (2, 'Should there be a legal cap on low-skill work visas even when employers say they can''t fill those roles locally?'),
  (3, 'Should net migration targets be legally binding on the Home Office, or advisory benchmarks reviewed annually by Parliament?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- IMMIGRATION > Public services capacity
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'immigration' and t.slug = 'public-services'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the NHS and schools are under too much pressure from population growth?'),
  (2, 'Should central government fund extra school places and GP slots specifically for areas with high migration rates?'),
  (3, 'Should housing and infrastructure funding be allocated per new arrival using a per-head formula, or through local authority bids?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- IMMIGRATION > Cultural integration
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'immigration' and t.slug = 'cultural-integration'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think new arrivals should be expected to adopt British values and customs?'),
  (2, 'Should English language tests be mandatory for all adult migrants before they receive full public services access?'),
  (3, 'Should integration metrics be linked to visa renewals, and if so, who should design and enforce those metrics?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- IMMIGRATION > Border security
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'immigration' and t.slug = 'border-security'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK''s border system is currently under control?'),
  (2, 'Should the UK have offshore processing centres for asylum claims, similar to Australia''s approach?'),
  (3, 'Should asylum seekers be permitted to work while their claim is processed, given the multi-year backlog?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- ECONOMY > Taxation
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'economy' and t.slug = 'taxation'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think wealthier people in the UK pay too little tax?'),
  (2, 'Should wealth taxes on assets like property and investments replace some income taxes?'),
  (3, 'Should inheritance tax be abolished, reformed, or increased, and what should the threshold be?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- ECONOMY > Trade
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'economy' and t.slug = 'trade'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK benefits from free trade, or does it come at too high a cost to domestic industries?'),
  (2, 'Should the UK prioritise rejoining the EU single market, striking new bilateral deals, or focusing on domestic industry?'),
  (3, 'Should the UK accept lower food standards in trade deals to get cheaper imports, or hold the line on current standards?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- ECONOMY > Employment
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'economy' and t.slug = 'employment'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the minimum wage should be higher than it is now?'),
  (2, 'Should zero-hours contracts be banned, regulated, or left to the market?'),
  (3, 'Should workers have a legal right to a four-day week without a pay cut if their job allows it?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- ECONOMY > Public debt
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'economy' and t.slug = 'public-debt'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Does the level of government borrowing concern you?'),
  (2, 'Should the government cut public services to reduce the debt, or invest more and grow out of it?'),
  (3, 'Should there be an independent fiscal council with legal power to veto budgets that breach debt rules?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HOUSING > Planning
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'housing' and t.slug = 'planning'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK builds enough houses?'),
  (2, 'Should planning rules be relaxed to allow more homes to be built on green belt land?'),
  (3, 'Should local councils be forced to meet national housing targets by law, with penalties for missing them?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HOUSING > Affordability
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'housing' and t.slug = 'affordability'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think renting in the UK is too expensive?'),
  (2, 'Should there be a national cap on rent increases tied to inflation?'),
  (3, 'Should landlords be required to accept housing benefit tenants, and should benefit rates automatically track local rents?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HOUSING > Social housing
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'housing' and t.slug = 'social-housing'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the government should build a lot more social housing?'),
  (2, 'Should local authorities be allowed to borrow freely to build social housing, without Treasury caps?'),
  (3, 'Should the right to buy be abolished so social homes stay in public ownership permanently?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HOUSING > Land ownership
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'housing' and t.slug = 'land-ownership'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think land ownership is too concentrated in the UK?'),
  (2, 'Should a land value tax replace council tax, so that land is taxed on its value not what''s built on it?'),
  (3, 'Should there be a public register of all land ownership in England, including overseas companies and trusts?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HEALTHCARE > NHS funding
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'healthcare' and t.slug = 'nhs-funding'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the NHS gets enough money?'),
  (2, 'Should NHS spending be protected by law from real-terms cuts, regardless of economic conditions?'),
  (3, 'Should NHS waiting time targets be legally enforceable, with consequences for trusts that miss them?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HEALTHCARE > Mental health
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'healthcare' and t.slug = 'mental-health'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think mental health services in the UK are good enough?'),
  (2, 'Should mental health funding be legally ring-fenced as a minimum share of total NHS spending?'),
  (3, 'Should GPs have a duty to refer patients with mental health conditions to NHS talking therapies within four weeks?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HEALTHCARE > Preventative
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'healthcare' and t.slug = 'preventative'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the government should do more to stop people getting ill in the first place?'),
  (2, 'Should the NHS fund weight-loss drugs for all clinically obese patients?'),
  (3, 'Should sugary drinks and ultra-processed foods face higher taxes, with revenue going directly to the NHS?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- HEALTHCARE > Pharmaceuticals
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'healthcare' and t.slug = 'pharmaceuticals'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK gets access to new medicines fast enough?'),
  (2, 'Should the UK harmonise drug approval rules with the EU to speed up access to new treatments?'),
  (3, 'Should pharmaceutical companies be required to license new medicines to the NHS at regulated prices in exchange for UK market access?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- CLIMATE > Net zero
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'climate' and t.slug = 'net-zero'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK should aim to cut carbon emissions to net zero by 2050?'),
  (2, 'Should net zero be brought forward to 2035, even if it means higher energy bills in the short term?'),
  (3, 'Should the UK''s net zero commitment be enshrined in a separate Climate Act with legal penalties for government departments that miss sector targets?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- CLIMATE > Energy transition
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'climate' and t.slug = 'energy-transition'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK should build more offshore wind farms and solar panels?'),
  (2, 'Should the UK restart its nuclear programme with a new generation of reactors as part of the energy mix?'),
  (3, 'Should the UK phase out all new fossil fuel extraction licences by 2030, including North Sea oil and gas?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- CLIMATE > Environmental regulation
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'climate' and t.slug = 'env-regulation'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think businesses in the UK should be more strictly regulated on environmental harm?'),
  (2, 'Should a new Environment Agency have legal powers to prosecute company executives personally for environmental crimes?'),
  (3, 'Should the UK introduce a carbon border tax on imports from countries without equivalent carbon pricing?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- CLIMATE > Adaptation
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'climate' and t.slug = 'adaptation'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK is doing enough to prepare for the effects of climate change like flooding and heat?'),
  (2, 'Should the government buy out properties in high-flood-risk areas and remove them from the insurance market?'),
  (3, 'Should national infrastructure projects like roads and railways face mandatory climate-risk assessments before planning approval?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- DEFENCE > NATO
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'defence' and t.slug = 'nato'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK should spend more on defence?'),
  (2, 'Should the UK commit to spending 2.5% of GDP on defence, up from the current 2%?'),
  (3, 'Should the UK station troops in Eastern Europe permanently as a deterrent to Russia, even at the cost of other defence programmes?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- DEFENCE > Nuclear
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'defence' and t.slug = 'nuclear'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK should keep its nuclear weapons?'),
  (2, 'Should the UK replace Trident with a newer submarine-launched system, even at a cost of over £200 billion?'),
  (3, 'Should the UK sign the Treaty on the Prohibition of Nuclear Weapons, committing to eventual disarmament?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- DEFENCE > Foreign aid
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'defence' and t.slug = 'foreign-aid'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK should give foreign aid to other countries?'),
  (2, 'Should foreign aid be restored to 0.7% of national income, as the UK was legally committed to before 2020?'),
  (3, 'Should foreign aid be conditional on recipient governments meeting human rights standards, even if it means withholding funds from poor populations?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- DEFENCE > Trade diplomacy
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'defence' and t.slug = 'trade-diplomacy'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think the UK''s relationship with the US is in good shape?'),
  (2, 'Should the UK sign a trade deal with the US even if it means accepting lower food and drug standards?'),
  (3, 'Should the UK adopt a formal policy of economic engagement with China, or treat China primarily as a security threat?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- EDUCATION > School funding
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'education' and t.slug = 'school-funding'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think schools in the UK get enough money?'),
  (2, 'Should per-pupil school funding be equalised nationally, so schools in poorer areas get the same as wealthier ones?'),
  (3, 'Should private school fees continue to be exempt from VAT, or should that exemption end and the revenue fund state schools?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- EDUCATION > Curriculum
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'education' and t.slug = 'curriculum'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think children are being taught the right things in UK schools?'),
  (2, 'Should financial literacy, mental health, and digital skills be compulsory in the national curriculum?'),
  (3, 'Should Ofsted inspection grades be replaced with richer data reports that don''t reduce a school to a single word?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- EDUCATION > Higher education
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'education' and t.slug = 'higher-ed'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think university tuition fees are too high?'),
  (2, 'Should tuition fees be abolished and universities funded entirely by the taxpayer?'),
  (3, 'Should student loan repayment terms be changed so graduates only repay when earning above the median wage?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- EDUCATION > Skills
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'education' and t.slug = 'skills'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think vocational training and apprenticeships are valued as much as university degrees?'),
  (2, 'Should employers be required to offer a minimum number of apprenticeships relative to their workforce size?'),
  (3, 'Should the apprenticeship levy be reformed so small businesses can access it more easily, even if that reduces funding for large firms?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- TECHNOLOGY > AI safety
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'technology' and t.slug = 'ai-safety'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Are you concerned about the risks that AI could pose to society?'),
  (2, 'Should AI systems used in public sector decisions like benefits or criminal justice face mandatory independent audits?'),
  (3, 'Should the UK create a statutory AI regulator with powers to suspend or ban AI systems that cause measurable harm?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- TECHNOLOGY > Data privacy
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'technology' and t.slug = 'data-privacy'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think your personal data is well protected online?'),
  (2, 'Should companies be required to get opt-in consent for all data collection, rather than opt-out?'),
  (3, 'Should the UK align its data protection rules fully with the EU''s GDPR, or maintain a lighter domestic framework to attract tech investment?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- TECHNOLOGY > Big tech
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'technology' and t.slug = 'big-tech'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think large technology companies like Google and Meta have too much power?'),
  (2, 'Should there be a legal duty on tech platforms to prevent the spread of content that is legal but known to cause harm?'),
  (3, 'Should the UK require tech platforms to provide researchers with access to their algorithms under non-disclosure conditions?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- TECHNOLOGY > Digital infrastructure
with s as (
  select t.id from public.taxonomy_subtopics t
  join public.taxonomy_categories c on c.id = t.category_id
  where c.slug = 'technology' and t.slug = 'digital-infra'
)
insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
select s.id, q.depth_layer, q.question_text from s
cross join (values
  (1, 'Do you think everyone in the UK should have access to fast broadband?'),
  (2, 'Should the government fund full-fibre broadband rollout to all rural areas where the market will not deliver it commercially?'),
  (3, 'Should broadband and mobile connectivity be treated as a public utility, with universal service obligations and regulated prices?')
) as q(depth_layer, question_text)
on conflict do nothing;

-- ---------------------------------------------------------------
-- Done.
-- ---------------------------------------------------------------
