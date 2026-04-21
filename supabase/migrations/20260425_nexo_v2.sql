-- =============================================================
-- NEXO V2 — messages, inferred_positions, collective_scores
-- Plus: opening questions on categories, yes/no question branching
-- Run this AFTER 20260419_nexo_taxonomy.sql
-- =============================================================

-- ---------------------------------------------------------------
-- 1. ADD COLUMNS to taxonomy_categories
-- ---------------------------------------------------------------

alter table public.taxonomy_categories
  add column if not exists opening_question text;

update public.taxonomy_categories set opening_question =
  'I''d love to hear your take on immigration — it''s one of those issues where people''s lived experiences really shape their views. What''s the aspect that matters most to you personally?'
where slug = 'immigration';

update public.taxonomy_categories set opening_question =
  'The economy touches everyone differently — cost of living, job security, what you think government should do about it. What''s most on your mind right now?'
where slug = 'economy';

update public.taxonomy_categories set opening_question =
  'Housing is a source of real anxiety for a lot of people. What''s your experience been like, and where do you think the problem actually lies?'
where slug = 'housing';

update public.taxonomy_categories set opening_question =
  'The NHS is something most of us feel deeply about. What''s been your experience, and what do you think needs to change — or should stay the same?'
where slug = 'healthcare';

update public.taxonomy_categories set opening_question =
  'Climate sits at the intersection of science, economics and values. Where do you stand, and what matters most to you about how we respond to it?'
where slug = 'climate';

update public.taxonomy_categories set opening_question =
  'Defence and foreign affairs can feel distant until they''re not. What''s your instinct about how the UK should position itself in the world right now?'
where slug = 'defence';

update public.taxonomy_categories set opening_question =
  'Education shapes everything from social mobility to national competitiveness. What aspects worry you, or what do you think we''re actually getting right?'
where slug = 'education';

update public.taxonomy_categories set opening_question =
  'Technology and AI are changing faster than policy can keep up with. What''s your biggest concern — or your biggest hope — about where this is heading?'
where slug = 'technology';

-- ---------------------------------------------------------------
-- 2. ADD COLUMNS to taxonomy_subtopics
-- ---------------------------------------------------------------

alter table public.taxonomy_subtopics
  add column if not exists latent_question_text      text,
  add column if not exists latent_question_yes_label text,
  add column if not exists latent_question_no_label  text;

-- ---------------------------------------------------------------
-- 3. YES/NO BRANCHING
-- ---------------------------------------------------------------

-- Add yes_next_id / no_next_id to taxonomy_questions if not already there
-- (the first migration may not have included these columns)
alter table public.taxonomy_questions
  add column if not exists yes_next_id uuid,
  add column if not exists no_next_id  uuid;

-- Use := (SELECT ...) assignment throughout — avoids the SELECT INTO
-- table-creation ambiguity that triggers "relation does not exist" errors.
-- Also checks for an existing no-branch before inserting (idempotent).

do $$
declare
  r             record;
  v_subtopic_id uuid;
  v_q1_id       uuid;
  v_q2_yes_id   uuid;
  v_q3_id       uuid;
  v_q2_no_id    uuid;
begin
  for r in
    select cat_slug, sub_slug, q2_no
    from (values
      ('immigration','labour-market',
        'Could immigration actually be creating more jobs and economic activity than it displaces? How should that argument affect policy, if at all?'),
      ('immigration','public-services',
        'If population pressure isn''t mainly from immigration, what''s actually driving strain on the NHS and schools — and what should we fix instead?'),
      ('immigration','cultural-integration',
        'Should cultural diversity be celebrated rather than managed — and if so, what role should the state play, if any, in facilitating that?'),
      ('immigration','border-security',
        'Would a system focused on legal pathways and safe returns actually reduce illegal crossings more than enforcement-led approaches?'),
      ('economy','taxation',
        'If some wealth concentration funds investment and growth, are there cases where redistribution can go too far — and where is that line?'),
      ('economy','trade',
        'Would pulling back from free trade agreements harm UK competitiveness — and which sectors deserve protection regardless of the costs?'),
      ('economy','employment',
        'If labour markets are broadly functioning, should government stay out of wage-setting and let market forces set the floor?'),
      ('economy','public-debt',
        'In periods of low real interest rates, does borrowing for infrastructure pay for itself over time — and should that change the debt debate?'),
      ('housing','planning',
        'Are some planning restrictions genuinely justified to protect communities and green space — and where exactly should the line be?'),
      ('housing','affordability',
        'If rents are high primarily because of supply shortfalls, are rent controls counterproductive — or do they protect people in the short term?'),
      ('housing','social-housing',
        'If social housing can reduce work incentives, should support be time-limited with clear transition programmes — or is that the wrong frame?'),
      ('housing','land-ownership',
        'Does private land ownership provide the stability and long-term investment that public ownership tends to struggle with?'),
      ('healthcare','nhs-funding',
        'Could a mixed public-private model actually improve outcomes without compromising access for those who can''t pay?'),
      ('healthcare','mental-health',
        'Is mental health sometimes over-medicalised — and would community-based and social interventions often work better than clinical treatment?'),
      ('healthcare','preventative',
        'If lifestyle choices drive a lot of poor health outcomes, is it fair for the NHS to fund treatment without any conditions attached?'),
      ('healthcare','pharmaceuticals',
        'Would stricter pharmaceutical regulation slow innovation and ultimately cost more lives than it saves?'),
      ('climate','net-zero',
        'If rapid net-zero targets harm economic competitiveness, should the UK wait for stronger global coordination before going further?'),
      ('climate','energy-transition',
        'Is the current pace of transition too fast for the grid and households to absorb — and what safety net should accompany it?'),
      ('climate','env-regulation',
        'Could market-based mechanisms like carbon pricing be more effective than direct regulation — with fewer economic distortions?'),
      ('climate','adaptation',
        'If some climate change is now locked in, should resources shift toward resilience and adaptation rather than emissions prevention?'),
      ('defence','nato',
        'Would the UK be better served by building independent defence capacity rather than relying on alliance commitments from partners?'),
      ('defence','nuclear',
        'Does the cost and risk of maintaining nuclear weapons outweigh their deterrence value given the modern threat landscape?'),
      ('defence','foreign-aid',
        'Is foreign aid primarily a tool of soft power and national interest — and should it be designed explicitly to serve those goals?'),
      ('defence','trade-diplomacy',
        'Should economic ties with authoritarian states be cut even if it raises prices for UK consumers and businesses?'),
      ('education','school-funding',
        'If per-pupil funding is adequate, is the real problem inefficiency or poor management rather than underfunding?'),
      ('education','curriculum',
        'Should schools have genuine local autonomy to adapt curriculum to their communities rather than following centrally imposed standards?'),
      ('education','higher-ed',
        'Would reducing university enrolment in favour of vocational training better serve the economy and reduce long-term graduate debt?'),
      ('education','skills',
        'Are apprenticeships still seen as inferior to degrees — and how should that perception problem drive policy design?'),
      ('technology','ai-safety',
        'Would heavy AI regulation push development to less scrupulous jurisdictions and ultimately make the world less safe?'),
      ('technology','data-privacy',
        'Is strong data privacy regulation actually stifling the AI capabilities the UK needs to remain competitive?'),
      ('technology','big-tech',
        'Do large tech platforms create efficiency and network value that fragmented smaller competitors couldn''t replicate?'),
      ('technology','digital-infra',
        'Should digital infrastructure be funded privately as much as possible to encourage innovation and avoid government inefficiency?')
    ) as t(cat_slug, sub_slug, q2_no)
  loop
    v_subtopic_id := (
      select st.id
      from public.taxonomy_subtopics st
      join public.taxonomy_categories c on c.id = st.category_id
      where c.slug = r.cat_slug and st.slug = r.sub_slug
      limit 1
    );

    if v_subtopic_id is null then continue; end if;

    v_q1_id     := (select id from public.taxonomy_questions where subtopic_id = v_subtopic_id and depth_layer = 1 limit 1);
    v_q2_yes_id := (select id from public.taxonomy_questions where subtopic_id = v_subtopic_id and depth_layer = 2 limit 1);
    v_q3_id     := (select id from public.taxonomy_questions where subtopic_id = v_subtopic_id and depth_layer = 3 limit 1);

    if v_q1_id is null or v_q2_yes_id is null or v_q3_id is null then continue; end if;

    -- check if no-branch already exists (supports idempotent re-runs)
    v_q2_no_id := (
      select id from public.taxonomy_questions
      where subtopic_id = v_subtopic_id
        and depth_layer = 2
        and id <> v_q2_yes_id
      limit 1
    );

    if v_q2_no_id is null then
      insert into public.taxonomy_questions
        (subtopic_id, depth_layer, question_text, yes_next_id, no_next_id)
      values
        (v_subtopic_id, 2, r.q2_no, v_q3_id, v_q3_id)
      returning id into v_q2_no_id;
    end if;

    update public.taxonomy_questions
      set yes_next_id = v_q3_id,
          no_next_id  = v_q3_id
      where id = v_q2_yes_id;

    if v_q2_no_id is not null then
      update public.taxonomy_questions
        set yes_next_id = v_q2_yes_id,
            no_next_id  = v_q2_no_id
        where id = v_q1_id;
    end if;

  end loop;
end $$;

-- ---------------------------------------------------------------
-- 4. MESSAGES TABLE
-- ---------------------------------------------------------------

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  session_id    text not null,
  category_id   uuid references public.taxonomy_categories(id),
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists messages_session_idx on public.messages(session_id, created_at);
create index if not exists messages_user_idx    on public.messages(user_id);

alter table public.messages enable row level security;

drop policy if exists "messages owner rw" on public.messages;
create policy "messages owner rw" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 5. INFERRED_POSITIONS
-- ---------------------------------------------------------------

create table if not exists public.inferred_positions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  session_id      text not null,
  category_id     uuid references public.taxonomy_categories(id),
  subtopic_id     uuid references public.taxonomy_subtopics(id),
  stance          text check (stance in ('yes', 'no', 'abstain', 'unclear')),
  confidence      numeric(4,3) default 0.5,
  reasoning       text,
  arguments_json  jsonb not null default '[]'::jsonb,
  weight_d        numeric(5,3),
  weight_q        numeric(5,3),
  weight_c        numeric(5,3),
  weight_total    numeric(5,3),
  deployed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, session_id, subtopic_id)
);

create index if not exists inferred_positions_user_idx     on public.inferred_positions(user_id);
create index if not exists inferred_positions_session_idx  on public.inferred_positions(session_id);
create index if not exists inferred_positions_subtopic_idx on public.inferred_positions(subtopic_id);
create index if not exists inferred_positions_deployed_idx
  on public.inferred_positions(deployed_at) where deployed_at is not null;

drop trigger if exists inferred_positions_touch on public.inferred_positions;
create trigger inferred_positions_touch
  before update on public.inferred_positions
  for each row execute procedure public.touch_updated_at();

alter table public.inferred_positions enable row level security;

drop policy if exists "inferred_positions owner rw" on public.inferred_positions;
create policy "inferred_positions owner rw" on public.inferred_positions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 6. COLLECTIVE_SCORES
-- ---------------------------------------------------------------

create table if not exists public.collective_scores (
  id                uuid primary key default gen_random_uuid(),
  subtopic_id       uuid not null references public.taxonomy_subtopics(id) on delete cascade,
  category_id       uuid references public.taxonomy_categories(id),
  total_responses   integer not null default 0,
  yes_weighted_pct  numeric(5,2) not null default 50,
  no_weighted_pct   numeric(5,2) not null default 50,
  abstain_count     integer not null default 0,
  tension_flag      text not null default 'contested'
    check (tension_flag in ('agreed', 'contested', 'disputed', 'hot')),
  top_yes_args      jsonb not null default '[]'::jsonb,
  top_no_args       jsonb not null default '[]'::jsonb,
  computed_at       timestamptz not null default now(),
  unique (subtopic_id)
);

create index if not exists collective_scores_category_idx on public.collective_scores(category_id);
create index if not exists collective_scores_tension_idx  on public.collective_scores(tension_flag);

alter table public.collective_scores enable row level security;

drop policy if exists "collective_scores read all" on public.collective_scores;
create policy "collective_scores read all" on public.collective_scores
  for select using (true);

-- ---------------------------------------------------------------
-- 7. REALTIME
-- ---------------------------------------------------------------

do $$
begin
  perform 1 from pg_publication_tables
    where pubname='supabase_realtime' and tablename='messages';
  if not found then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

do $$
begin
  perform 1 from pg_publication_tables
    where pubname='supabase_realtime' and tablename='inferred_positions';
  if not found then
    execute 'alter publication supabase_realtime add table public.inferred_positions';
  end if;
end $$;

-- ---------------------------------------------------------------
-- 8. SESSIONS
-- ---------------------------------------------------------------

create table if not exists public.sessions (
  id          text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  category_id uuid references public.taxonomy_categories(id),
  started_at  timestamptz not null default now(),
  last_active timestamptz not null default now()
);

create index if not exists sessions_user_idx on public.sessions(user_id, last_active desc);

alter table public.sessions enable row level security;

drop policy if exists "sessions owner rw" on public.sessions;
create policy "sessions owner rw" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
