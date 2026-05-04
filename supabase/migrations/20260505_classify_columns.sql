-- =============================================================
-- Add question_id to collective_scores and inferred_positions
-- for the advisor-driven classification flow.
-- Run AFTER 20260504_submit_views.sql
-- =============================================================

-- 1. Add question_id to collective_scores
ALTER TABLE public.collective_scores
  ADD COLUMN IF NOT EXISTS question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE;

-- Make subtopic_id nullable so question-scoped rows don't need a subtopic
ALTER TABLE public.collective_scores
  ALTER COLUMN subtopic_id DROP NOT NULL;

-- Partial unique index for question-scoped rows
CREATE UNIQUE INDEX IF NOT EXISTS collective_scores_question_uniq
  ON public.collective_scores(question_id)
  WHERE question_id IS NOT NULL;

-- 2. Partial unique index on inferred_positions(user_id, question_id)
--    Allows multiple rows per user+subtopic session but only one per user+question
CREATE UNIQUE INDEX IF NOT EXISTS inferred_positions_user_question_uniq
  ON public.inferred_positions(user_id, question_id)
  WHERE question_id IS NOT NULL;
