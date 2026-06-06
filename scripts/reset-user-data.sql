-- ═══════════════════════════════════════════════════════════
-- Nexus — Full User Data Reset
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
--
-- KEEPS: taxonomy_categories, taxonomy_subtopics,
--        taxonomy_questions, questions, manifesto_categories
-- WIPES: everything user-generated
-- ═══════════════════════════════════════════════════════════

-- 1. Wipe user-generated data (CASCADE handles FK order)
TRUNCATE TABLE
  public.conversations,
  public.messages,
  public.sessions,
  public.inferred_positions,
  public.user_views,
  public.draft_stances,
  public.user_stances,
  public.public_question_stances,
  public.collective_scores,
  public.public_nodes,
  public.personal_links,
  public.links,
  public.merged_nodes,
  public.contradiction_flags,
  public.manifesto_clauses,
  public.share_snapshots,
  public.debate_outcomes,
  public.debate_token_log,
  public.auth_events,
  public.feedback,
  public.notification_preferences,
  public.moderation_log,
  public.api_spend_log,
  public.api_budget,
  public.profiles
RESTART IDENTITY CASCADE;

-- 2. Delete all auth users
-- (profiles were already wiped above; this removes login credentials)
DELETE FROM auth.users;

-- 3. Confirm what's still intact
SELECT 'taxonomy_categories' AS table_name, COUNT(*) AS rows FROM public.taxonomy_categories
UNION ALL
SELECT 'taxonomy_subtopics', COUNT(*) FROM public.taxonomy_subtopics
UNION ALL
SELECT 'questions', COUNT(*) FROM public.questions
UNION ALL
SELECT 'profiles', COUNT(*) FROM public.profiles
UNION ALL
SELECT 'auth.users', COUNT(*) FROM auth.users;
