-- =============================================================
-- personal_links — green/red arcs on the personal globe
-- Run AFTER 20260507_public_nodes_enhance.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS public.personal_links (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  node_a_id    uuid    NOT NULL REFERENCES public.user_views(id) ON DELETE CASCADE,
  node_b_id    uuid    NOT NULL REFERENCES public.user_views(id) ON DELETE CASCADE,
  relationship text    NOT NULL CHECK (relationship IN ('supporting', 'contradicting')),
  strength     float   NOT NULL DEFAULT 0.5,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One link per ordered pair per user
  CONSTRAINT personal_links_pair_unique UNIQUE (user_id, node_a_id, node_b_id)
);

CREATE INDEX IF NOT EXISTS personal_links_user_idx  ON public.personal_links(user_id);
CREATE INDEX IF NOT EXISTS personal_links_node_a_idx ON public.personal_links(node_a_id);
CREATE INDEX IF NOT EXISTS personal_links_node_b_idx ON public.personal_links(node_b_id);

ALTER TABLE public.personal_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_links owner rw" ON public.personal_links;
CREATE POLICY "personal_links owner rw" ON public.personal_links
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
