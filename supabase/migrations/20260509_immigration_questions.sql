-- =============================================================
-- Seed L1 + L2 immigration questions into the questions table.
-- taxonomy.json is the source of truth; this seeds the DB directly
-- so the advisor can classify beliefs without running seed-questions.ts.
-- Run AFTER 20260508_personal_links.sql
-- =============================================================

DO $$
DECLARE
  v_cat_id     uuid;
  v_sub_border uuid;
  v_sub_labour uuid;
  v_l1_id      uuid;
  v_l2_yes_id  uuid;
  v_l2_no_id   uuid;
BEGIN
  -- Get immigration category
  SELECT id INTO v_cat_id FROM public.taxonomy_categories WHERE slug = 'immigration' LIMIT 1;
  IF v_cat_id IS NULL THEN RAISE NOTICE 'immigration category not found — skipping'; RETURN; END IF;

  -- Get subtopics (created by earlier migrations)
  SELECT id INTO v_sub_border FROM public.taxonomy_subtopics WHERE category_id = v_cat_id AND slug = 'border-security' LIMIT 1;
  SELECT id INTO v_sub_labour FROM public.taxonomy_subtopics WHERE category_id = v_cat_id AND slug = 'labour-market' LIMIT 1;

  -- ----------------------------------------------------------------
  -- Tree 1: Should the UK reduce overall net migration levels?
  -- ----------------------------------------------------------------
  -- Only insert if not already present (idempotent)
  SELECT id INTO v_l1_id
    FROM public.questions
    WHERE category_id = v_cat_id AND layer = 1
      AND question_text = 'Should the UK government actively reduce overall net migration levels through stricter entry controls?'
    LIMIT 1;

  IF v_l1_id IS NULL THEN
    INSERT INTO public.questions (category_id, subtopic_id, layer, question_text, is_tension)
    VALUES (v_cat_id, v_sub_border, 1, 'Should the UK government actively reduce overall net migration levels through stricter entry controls?', false)
    RETURNING id INTO v_l1_id;
  END IF;

  -- L2 YES branch: target economic migrants
  SELECT id INTO v_l2_yes_id
    FROM public.questions WHERE parent_question_id = v_l1_id AND parent_answer = 'yes' LIMIT 1;

  IF v_l2_yes_id IS NULL THEN
    INSERT INTO public.questions (category_id, subtopic_id, parent_question_id, parent_answer, layer, question_text, is_tension)
    VALUES (v_cat_id, v_sub_labour, v_l1_id, 'yes', 2, 'Should reductions primarily target economic migrants rather than family reunification and humanitarian visas?', false)
    RETURNING id INTO v_l2_yes_id;
  END IF;

  -- L2 NO branch: more legal routes for asylum seekers
  SELECT id INTO v_l2_no_id
    FROM public.questions WHERE parent_question_id = v_l1_id AND parent_answer = 'no' LIMIT 1;

  IF v_l2_no_id IS NULL THEN
    INSERT INTO public.questions (category_id, subtopic_id, parent_question_id, parent_answer, layer, question_text, is_tension)
    VALUES (v_cat_id, v_sub_border, v_l1_id, 'no', 2, 'Should the UK create more legal routes for asylum seekers to reduce irregular channel crossings?', false)
    RETURNING id INTO v_l2_no_id;
  END IF;

  -- ----------------------------------------------------------------
  -- Tree 2: Points-based system / high-skilled only (labour-market)
  -- ----------------------------------------------------------------
  SELECT id INTO v_l1_id
    FROM public.questions
    WHERE category_id = v_cat_id AND layer = 1
      AND question_text = 'Should the UK implement a strict points-based immigration system that prioritises high-skilled workers?'
    LIMIT 1;

  IF v_l1_id IS NULL THEN
    INSERT INTO public.questions (category_id, subtopic_id, layer, question_text, is_tension)
    VALUES (v_cat_id, v_sub_labour, 1, 'Should the UK implement a strict points-based immigration system that prioritises high-skilled workers?', false)
    RETURNING id INTO v_l1_id;
  END IF;

  SELECT id INTO v_l2_yes_id FROM public.questions WHERE parent_question_id = v_l1_id AND parent_answer = 'yes' LIMIT 1;
  IF v_l2_yes_id IS NULL THEN
    INSERT INTO public.questions (category_id, subtopic_id, parent_question_id, parent_answer, layer, question_text, is_tension)
    VALUES (v_cat_id, v_sub_labour, v_l1_id, 'yes', 2, 'Should the salary threshold for skilled worker visas be set above £50,000 per year?', true)
    RETURNING id INTO v_l2_yes_id;
  END IF;

  SELECT id INTO v_l2_no_id FROM public.questions WHERE parent_question_id = v_l1_id AND parent_answer = 'no' LIMIT 1;
  IF v_l2_no_id IS NULL THEN
    INSERT INTO public.questions (category_id, subtopic_id, parent_question_id, parent_answer, layer, question_text, is_tension)
    VALUES (v_cat_id, v_sub_labour, v_l1_id, 'no', 2, 'Should sectors with chronic shortages like healthcare and hospitality have dedicated visa routes outside any cap?', false)
    RETURNING id INTO v_l2_no_id;
  END IF;

END $$;
