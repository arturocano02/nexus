-- =============================================================
-- Enhance public_nodes with full field set + fix debate_outcomes FK
-- Run AFTER 20260506_submit_pipeline.sql
-- =============================================================

-- 1. Add missing columns to public_nodes
ALTER TABLE public.public_nodes
  ADD COLUMN IF NOT EXISTS is_resolved       boolean    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tension_coefficient float     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS noise_saturation  float      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debate_log        jsonb      NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS top_points        jsonb      NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS clarifying_question text;

-- 2. Fix debate_outcomes FK (was pointing at a dropped table)
--    debate_outcomes.node_id → public_nodes(id)
ALTER TABLE public.debate_outcomes
  DROP CONSTRAINT IF EXISTS debate_outcomes_node_id_fkey;

ALTER TABLE public.debate_outcomes
  ADD CONSTRAINT debate_outcomes_node_id_fkey
  FOREIGN KEY (node_id) REFERENCES public.public_nodes(id) ON DELETE CASCADE;
