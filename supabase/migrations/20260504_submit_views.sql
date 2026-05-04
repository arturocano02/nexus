-- Add last_submitted_at to profiles (tracks when user last deployed views)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_submitted_at timestamptz DEFAULT NULL;

-- Add user_overridden to user_views (prevents AI from overwriting manual slider edits)
ALTER TABLE user_views
  ADD COLUMN IF NOT EXISTS user_overridden boolean NOT NULL DEFAULT false;
