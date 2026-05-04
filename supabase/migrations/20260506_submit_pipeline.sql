-- =============================================================
-- Submit pipeline additions
-- Run AFTER 20260505_classify_columns.sql
-- =============================================================

-- 1. agent_id on user_views — links all views from one submission session
ALTER TABLE public.user_views
  ADD COLUMN IF NOT EXISTS agent_id uuid;

-- 2. public_nodes — one row per taxonomy category, maintained by the submit pipeline
CREATE TABLE IF NOT EXISTS public.public_nodes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      uuid NOT NULL REFERENCES public.taxonomy_categories(id) ON DELETE CASCADE,
  topic_label      text NOT NULL,
  consensus_summary text NOT NULL DEFAULT '',
  agreement_pct    numeric(5,2) NOT NULL DEFAULT 50,
  contributor_count integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id)
);

CREATE INDEX IF NOT EXISTS public_nodes_category_idx ON public.public_nodes(category_id);

ALTER TABLE public.public_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_nodes read all" ON public.public_nodes;
CREATE POLICY "public_nodes read all" ON public.public_nodes
  FOR SELECT USING (true);
