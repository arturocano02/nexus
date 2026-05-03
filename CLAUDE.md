# Nexo — Background Knowledge for Claude

This file is permanent background context for Claude AI working on the Nexo codebase.
Read this before making any changes to understand the architecture, data model, and project goals.

---

## What is Nexo?

Nexo is a **live political sentiment platform** for the UK (2026). Users have political conversations
with an AI interviewer that extracts their positions through natural dialogue. Those positions are
visualised as a personal 3D "political mind map" and then deployed to a public arena where individual
stances combine into a live collective output — a real-time political manifesto.

The core loop:
1. User picks a category (Housing, Economy, etc.)
2. AI conducts a Socratic interview — sharp, combative, devil's advocate
3. Background classifier infers their YES/NO positions on binary question trees (L1–L5)
4. User reviews inferred positions in ReviewPanel and deploys ("Deploy to Manifesto")
5. Deployed positions are weighted by W = D × Q × C and aggregated into `collective_scores`
6. The Arena page shows the live collective output

---

## Tech Stack

- **Framework**: Next.js 14 App Router, TypeScript, Tailwind CSS
- **Database**: Supabase (Postgres + RLS + Realtime)
- **Auth**: Supabase Auth
- **AI**: Anthropic Claude API — `claude-sonnet-4-5-20251001` (or MODEL env)
- **3D**: React Three Fiber + Three.js (r128), MeshDistortMaterial, additive blending
- **Animation**: Framer Motion
- **Voice** (planned): Web Speech API + Whisper fallback
- **Rate limiting** (planned): Upstash Redis
- **Analytics** (planned): PostHog + Sentry
- **Email** (planned): Resend

---

## File Structure

```
app/
  (app)/
    your-view/     — personal globe + chat + review
    arena/         — collective output globe
    manifesto/     — /manifesto/[user_id] public profile (Task 8, not yet built)
    profile/       — user profile
  api/
    chat/          — SSE conversation stream + background classify
    submit/        — GET (review items) + POST (deploy positions)
    aggregate/     — recompute collective_scores
    positions/     — DELETE single or by category (Task 1/2, partially built)
components/
  NodeMap.tsx      — React Three Fiber globe with satellites
  ReviewPanel.tsx  — slide-up review panel
  TopicDetailPanel.tsx — subtopic detail or category summary
  ConversationPanel.tsx — chat UI
lib/
  types.ts         — all TypeScript interfaces
  anthropic.ts     — Anthropic client
  supabase/        — server + service clients
data/
  taxonomy.json    — 21 binary decision trees (L1-L5, YES/NO diverging paths)
scripts/
  seed-questions.ts — seeds questions table from taxonomy.json
supabase/migrations/ — V1 through V5 migrations + auth + advisor
```

---

## Database Schema (current as of V5)

### Core tables

**`taxonomy_categories`** — 8 categories: housing, economy, defence, healthcare, climate, education, technology, immigration

**`taxonomy_subtopics`** — 3-4 subtopics per category, with `latent_question_text` for the AI's hidden goal

**`taxonomy_questions`** (old V4 table) — 3-layer question chains per subtopic. DEPRECATED in favour of `questions`.

**`questions`** (V5) — binary decision tree nodes
```sql
id, category_id, subtopic_id, parent_question_id, parent_answer ('yes'|'no'), layer (1-5),
question_text, is_tension (⚡ marks value contradictions), created_at
```
Root nodes: `parent_question_id IS NULL AND parent_answer IS NULL`
Child nodes: `parent_question_id IS NOT NULL AND parent_answer IS NOT NULL`

**`sessions`** — one per user+category conversation, with `last_active`

**`messages`** — full chat history (role: user|assistant)

**`inferred_positions`** — raw session-level inference results
```sql
user_id, session_id, category_id, subtopic_id, question_id,
stance ('yes'|'no'|'abstain'|'unclear'), confidence (0-1), reasoning, arguments_json,
weight_d, weight_q, weight_c, weight_total, updated_at
```
Unique on: `user_id, session_id, subtopic_id`

**`user_views`** — persistent cross-session user position
```sql
user_id, topic_label, summary, confidence_score, raw_excerpts (jsonb),
submitted_to_arena, is_deleted, updated_at
```
Submitted views are read-only (cannot be overwritten by new inference).

**`collective_scores`** — aggregated output, recomputed by `/api/aggregate`
```sql
category_id, subtopic_id, score (-1 to 1), participant_count, total_weight, updated_at
```

**`profiles`** — one per auth user, `display_name`, `created_at`

### RLS policy pattern
- All tables: public SELECT, authenticated INSERT/UPDATE own rows, service-role writes for AI ops

---

## Weight Formula: W = D × Q × C

- **D (Depth)** — which layer the user reached: L1=1.0, L2=2.0, L3=3.0, L4=4.0, L5=5.0
- **Q (Argument Quality)** — AI-scored 0–1 based on the argument the user gave
- **C (Confidence)** — classifier confidence 0–1

Applied in `/api/submit` POST handler.

---

## Binary Taxonomy Structure

`data/taxonomy.json` contains 21 topics across 8 categories (immigration = []).
Each topic is an L1-L5 binary tree where YES and NO at every level lead to genuinely
different follow-up questions (not just variations of the same theme).

Format:
```json
{
  "housing": [
    {
      "name": "Should the government build significantly more homes?",
      "slug": "should-the-government-build-significantly-more-homes",
      "subtopicSlug": "build-more-homes-significantly",
      "layer": 1,
      "text": "Should the government actively intervene in the housing market...",
      "is_tension": false,
      "yes": { "layer": 2, "text": "...", "is_tension": false, "yes": {...}, "no": {...} },
      "no":  { ... }
    }
  ]
}
```

Seed with: `npx tsx scripts/seed-questions.ts`

---

## Key Conventions

### API patterns
- `/api/chat` — SSE stream, `data: {"type":"delta","text":"..."}` / `data: {"type":"done"}`
- All routes check Supabase auth (`supabaseServer().auth.getUser()`)
- Service-role writes go through `supabaseService()` (bypasses RLS)
- Fire-and-forget async: `triggerClassify(...).catch(console.warn)`

### React patterns
- Data loading always in `useEffect`, never in render body
- Framer Motion `AnimatePresence` wraps all modal/panel mounts
- `SessionProvider` context holds `sessionId`, `categoryId`, `categorySlug`

### UI design language
- Dark background: `rgba(6,6,22,0.97)`
- Primary accent: `#FFBF00` (gold)
- Yes = `#00DCFF` (cyan), No = `#FF5A6A` (red), Abstain = `#888780` (grey)
- Font: `font-display` = display font for headings, `font-mono` for labels
- Uppercase tracking labels: `text-[9px] tracking-[0.3em] font-bold`

---

## What's Built vs What's Pending

### Built
- Auth (login/signup/middleware)
- Category selection + session creation
- Chat API with background classification
- ReviewPanel with stance editing + weight display
- NodeMap 3D globe with category nodes + satellite blobs
- TopicDetailPanel (subtopic detail + category summary modes)
- Submit/deploy flow (W = D × Q × C weighting)
- Aggregate API (collective_scores recomputation)
- V1-V5 database migrations
- taxonomy.json (21 topics, 651 question nodes)
- seed-questions.ts script

### Needs changing
- `/api/chat` still uses `taxonomy_questions` (old V4) for subtopic goals — should use `questions` (V5)
- Multi-tag classification (Task 4): classify against multiple subtopics simultaneously
- `inferred_positions` → should use `question_id` from V5 `questions` table (FK already added)

### Not yet built
- `DELETE /api/positions/[id]` — retract single position (Task 1)
- `DELETE /api/positions/category/[category_id]` — retract all in category (Task 2)
- `POST /api/detect-contradictions` + `contradiction_flags` table (Task 5)
- `POST /api/infer-category-stance` + `category_stances` table (Task 6)
- Blob link visualization in NodeMap (Task 7)
- `/manifesto/[user_id]` — public individual manifesto page (Task 8)
- Voice input (Web Speech API + Whisper fallback)
- Upstash Redis rate limiting
- PostHog analytics + Sentry error tracking
- Resend transactional email
- Immigration question trees (taxonomy.json immigration = [])

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
```

## Running Locally

```bash
npm install
npm run dev          # http://localhost:3000
npx tsx scripts/seed-questions.ts   # after running all migrations
```
