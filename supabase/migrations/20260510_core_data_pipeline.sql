-- =============================================================
-- Core data pipeline fix
-- 1. Add core_argument to inferred_positions
-- 2. Create public_question_stances (anonymised deployed stances)
-- 3. Add yes_count + no_count to collective_scores
-- Run AFTER 20260509_immigration_questions.sql
-- =============================================================

-- 1. core_argument on inferred_positions
ALTER TABLE public.inferred_positions
  ADD COLUMN IF NOT EXISTS core_argument text;

-- 2. public_question_stances — one row per deployed stance, agent anonymised
CREATE TABLE IF NOT EXISTS public.public_question_stances (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid         NOT NULL,
  question_id   uuid         NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  category_id   uuid         REFERENCES public.taxonomy_categories(id) ON DELETE SET NULL,
  stance        text         NOT NULL CHECK (stance IN ('yes', 'no', 'abstain')),
  confidence    numeric(4,3) NOT NULL DEFAULT 0.5,
  core_argument text,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pqs_question_idx  ON public.public_question_stances(question_id);
CREATE INDEX IF NOT EXISTS pqs_agent_idx     ON public.public_question_stances(agent_id);
CREATE INDEX IF NOT EXISTS pqs_category_idx  ON public.public_question_stances(category_id);

ALTER TABLE public.public_question_stances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pqs read all" ON public.public_question_stances;
CREATE POLICY "pqs read all" ON public.public_question_stances
  FOR SELECT USING (true);

-- Service role insert (bypasses RLS for deploy pipeline)
DROP POLICY IF EXISTS "pqs service insert" ON public.public_question_stances;
CREATE POLICY "pqs service insert" ON public.public_question_stances
  FOR INSERT WITH CHECK (true);

-- 3. yes_count + no_count on collective_scores
ALTER TABLE public.collective_scores
  ADD COLUMN IF NOT EXISTS yes_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.collective_scores
  ADD COLUMN IF NOT EXISTS no_count  integer NOT NULL DEFAULT 0;
