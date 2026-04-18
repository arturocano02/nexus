# Nexus

Your argument. The world's debate.

A full stack political discourse app. Three screens: **Your View** (a live 3D map of your beliefs you build by talking to Claude), **The Arena** (the global debate graph of all submitted views), and **Profile** (settings + data control).

## Stack

- Next.js 14 (App Router)
- Supabase (auth + Postgres + Realtime)
- Anthropic API, model `claude-sonnet-4-20250514`
- React Three Fiber / Three.js for 3D
- Framer Motion for transitions
- Tailwind CSS

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase project

1. Create a new project at https://supabase.com
2. Open SQL editor and run `supabase/schema.sql`, then `supabase/policies.sql`
3. In Authentication > Providers, enable **Anonymous sign-ins**
4. In Storage, create a **public** bucket called `avatars` (needed for the profile page avatar upload)
5. (Optional) Create a database webhook on `public_nodes` insert pointing at `POST /api/debate`

### 3. Env vars

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
DEBATE_WEBHOOK_SECRET=any-random-string
```

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000. You'll be signed in anonymously. Start speaking in the mic, or type, and watch nodes appear.

## How it's wired

- **Screen 1** (`/your-view`): Web Speech API transcribes -> `POST /api/chat` -> Claude returns `{ message, belief_updates }` -> server upserts into `personal_arguments` -> Realtime pushes the row back into the 3D map.
- **Submit views**: `GET /api/submit` polishes unsubmitted arguments. `POST /api/submit` inserts `public_nodes` + `agents` and kicks the debate engine.
- **Screen 2** (`/arena`): Subscribes to `public_nodes`, `agents`, `manifesto`. Shows live counters and manifesto rolldown.
- **Debate engine** (`POST /api/debate`): Neutral moderator prompt, bounded to 800 tokens. Outputs consensus points, unresolved points, agreement_pct, tension_coefficient, top_points. From the 3rd agent onwards we debate against the consensus summary only, not every prior agent.
- **Screen 3** (`/profile`): Self-service profile + retraction + data export + account delete.

## Performance notes

- 3D nodes beyond the active-cap are static (no physics).
- Nodes farther than 18 units from the camera render with low-poly spheres.
- Streaming on `/api/chat` via ndjson; the UI renders deltas live.
- Supabase Realtime updates trigger React state setters, not full remounts.

## Known "next steps" beyond tonight

- Topic-merge via embeddings (currently merges by case-insensitive label).
- Public email/password auth UI (anonymous works out of the box; link an email later via `supabase.auth.updateUser`).
- Debate webhook signing (the `DEBATE_WEBHOOK_SECRET` is honored if set; leave unset for local dev).
- Unit tests.

## Scripts

- `npm run dev` local dev server
- `npm run build` production build
- `npm run start` production server
