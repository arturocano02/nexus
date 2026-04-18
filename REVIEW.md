# Nexus: codebase review and path to shipping

Audit date: 2026-04-18. Scope: every source file in the repo, the two SQL files, and the semantic + debate layer you added in Anti-gravity.

---

## TL;DR

The visual language is there. The Anti-gravity additions (Claude-driven semantic links, debate router, distortion blobs, vortex transition, fake-persona seeder) are strong. But three things silently broke along the way, and five of your own design asks (labeled lines, centered chat, always-living map, consistent premium, clickable lines) aren't fully wired yet. Fix order at the bottom.

---

## What's solid and should not be touched

1. **NodeMap force-directed physics.** The `NodeField` component with per-node position + velocity state and the repulsion / attraction / gravity loop is better than anything I had in v1. It now behaves like a real dynamic system, which is exactly what you asked for ("always changing as you speak"). The `physicsBoost` vortex mode is a beautiful touch.
2. **MeshDistortMaterial + dual-light rig.** Cyan/amber lights + distortion on emissive blobs reads premium. Keep.
3. **Claude-only semantic pipeline.** `lib/semantic.ts` using Claude to find similarity + write `link_summary` instead of 1536-dim OpenAI embeddings is the right call for a one-night MVP. You skip a vector index setup and you get human-readable reasoning for free ("these are counteracting because...").
4. **Debate router `lib/debate_router.ts`.** Matching opponents by Claude intent ("what would create the most tense conflict") is a design choice Hidalgo would nod at.
5. **Anti-gravity visual layer.** Fake-persona seed route, vortex transition from Your View -> Arena, HUD toggle, and the distortion blobs together give the app a real identity.
6. **LinkOverlay design.** Copy tone ("Analyzing the relationship..."), similarity percentage badge, amber-glow accent card. The shell is good. It's not wired up yet, but the art is done.

---

## Critical regressions: fix tonight

These came from the Anti-gravity rewrite and break the core loop.

### 1. Chat no longer writes belief nodes

`app/api/chat/route.ts` was slimmed to stream only `{ message }`. The `belief_updates` array is gone. That means: user talks to Nexus, nothing gets inserted into `personal_arguments`, no nodes appear on the map. Your Screen 1 premise is currently broken.

**Fix:** restore the original system prompt that asks for `{ message, belief_updates[] }`, parse on the server after stream ends, and do `upsertBelief()` against `personal_arguments`. The client subscription will then animate new nodes in.

### 2. Personal map no longer subscribes to `personal_arguments`

In `your-view/page.tsx`, the Supabase Realtime channel only listens to the `links` table now. New personal_arguments rows don't push back to the UI, so even if (1) is fixed, the map won't update live. Must subscribe to `personal_arguments` with `filter: user_id=eq.${user.id}` and merge rows into state on `INSERT` and `UPDATE`.

### 3. ManifestoBar is hardcoded mock data

`components/ManifestoBar.tsx` shows "AI Governance / Universal Income / Digital Citizenship" as static literals. There's no Supabase fetch, no realtime listener. It looks great in a demo but lies about consensus. Must re-wire to `manifesto` table, ordered by `agreement_pct desc`, with a Realtime channel. Show tension + noise live at the footer.

### 4. LinkOverlay is imported but never rendered in Your View

`your-view/page.tsx` imports `LinkOverlay` and holds `selectedLink` state, but the JSX doesn't render `<LinkOverlay ... />`. Arena does. One-line fix.

### 5. `NodeMap` drops `onSelectLink` + Connection has no click handler

Your View and Arena both pass `onSelectLink={setSelectedLink}`, but the default export at `components/NodeMap.tsx:225` doesn't destructure it, so it gets silently swallowed. `Connection` renders an `<Line>` with no `onClick`. You literally cannot click a line right now.

### 6. Schema drift

`supabase/schema.sql` does not include the `links` table, `merged_from`, `debate_token_log`, or the `match_nodes` function. Those live only in `supabase/migrations/20260418_semantic_updates.sql`. If a new collaborator runs `schema.sql` alone, the app breaks on boot. Unify, or clearly document "run schema.sql THEN migration 20260418".

---

## Your specific design asks, translated into code plans

### A. Labeled lines ("see the lines and put text in those lines")

Right now lines render but carry no label. The data is already there: `link.link_summary` holds 10 words of Claude reasoning. Plan:

- In `Connection`, place a `<Html>` at the midpoint of the QuadraticBezier curve (`curve.getPointAt(0.5)`) containing a tiny pill with the first 2 to 4 words of `link_summary`.
- Pill style: glass background, 9px uppercase tracking-widest, amber-or-cyan border matching the line color, shadow soft.
- Hover expands to full `link_summary`. Click fires `onSelectLink(link)` and LinkOverlay opens showing the full blurb + the two node labels.
- Make `Connection` accept `onSelectLink` via prop. Wire `NodeMap` default export to forward it.

### B. Centered conversation ("when I'm chatting to the AI")

Current layout has assistant bubbles at `top-24 left-6 max-w-sm`. Move to:

- Messages stack centered on the upper third of the screen. Width capped to `max-w-2xl`. Horizontal center via `left-1/2 -translate-x-1/2`.
- Input stays bottom-centered (already is).
- Streaming bubble replaces the last assistant message in place, no layout jump, with a blinking caret.
- On idle (no messages for 8s), bubbles auto-fade to 30% opacity so the map breathes.

### C. Always-living map

The Arena map currently won't update without a page reload because Realtime only listens to `public_nodes` inserts, not `agents` or `links`. For the "always changing" feel:

- Subscribe to `agents` (for counter animations), `public_nodes` (for pulse + agreement changes), `links` (for new connections drawing in), and `manifesto` (for the bar).
- Every new link should animate in, not jump in. Already partly supported via the `isNew` prop, but nothing sets it. When a row arrives via Realtime, mark the link `isNew=true` for 1.2s, then fall back.
- Add an ambient "breathing" drift: a tiny sine wave on each node's target position so even idle maps feel alive.

### D. Consistent premium design system

Points of drift I found while reading:

- Background is sometimes `#000033` (spec + globals.css), sometimes `#080a18` (NodeMap, Your View, Arena). Pick one. I recommend `#050515` as a compromise that reads darker without going full black. Set it in `tailwind.config.ts` under `colors.navy.DEFAULT` and in the Canvas `<color attach="background">`.
- Button vocabulary mixes `btn-primary / btn-outline / btn-ghost` (my original) with inline classes ("glass px-10 py-4 rounded-full..."). Refactor to one system so all buttons share hover / active / shadow. Keep the semantics: amber-filled for primary actions (Submit, Inject), ghost for HUD toggles, cyan-filled for arena-level actions.
- Z-index values sprawl from 20 to 260. Define a scale in globals.css (`--z-map:0 --z-hud:20 --z-overlay:40 --z-modal:190`).
- Font hierarchy: enforce `font-display` on headings only; body + labels always `font-body`. There are a few `font-display` labels in HUDs that should be body weight.

---

## What's still missing, ordered by user impact

1. **The personal map doesn't grow during conversation.** (covered above in regressions)
2. **Line labels + line click.** (your top visual ask)
3. **Centered chat.**
4. **Live arena (realtime on all 4 tables).**
5. **Ambient empty-state prompt** after 30s with zero nodes. Was in v1, got deleted.
6. **[DISPUTED] fact-check pill.** The original chat prompt asked Claude to tag disputed claims with `[DISPUTED]` and the UI renders them as cyan chips. Both are gone now. Political app without fact-checking visible is a credibility miss.
7. **"Another voice said" injection.** The API call in v1 pulled 3 random anonymised points from the arena and fed them into the chat system prompt so Claude could surface them mid-conversation. Removed. Put it back; this is Nexus's edge.
8. **Quality score on arguments.** You're currently tracking agreement only. Add a score that rises with (a) survival across debate rounds, (b) novelty (Claude ranks novelty vs prior top_points), (c) citations/evidence if present. Feed it into manifesto ordering so well-argued minority voices rank high even at low agreement.
9. **Debate round caps.** `/api/debate` can run unbounded as more agents join a node. Cap it: after N rounds without >5% agreement movement, freeze the node and mark `is_resolved=false, is_stalemated=true`. Cheaper and more honest.
10. **"Minority dissent" surface.** Resolved nodes currently collapse dissenting positions. Keep them as a separate `dissent_points` array on the node and render them in the overlay under "Well-argued minority views".
11. **Transparency drawer.** Any user should be able to tap an "i" on the manifesto or a resolved node and see: which agents contributed, which rounds happened, what the prompt was. Habermas-Machine critique told you this.
12. **Export as Pol.is-style CSV.** For researchers / journalists. Cheap to add.
13. **Account linking.** Anonymous-first works but people will lose their data if they clear cookies. Add "link to email" button that calls `supabase.auth.updateUser({ email })`.
14. **Dead code.** `lib/openai.ts` is installed but never imported. Either remove the file + dep or keep it as a fallback if `OPENAI_API_KEY` is set.

---

## Debate engine, principled version

Pulling Hidalgo + Habermas Machine + the critique papers together, here's what the debate layer should enforce. Six rules, all encodable as prompt constraints + schema checks.

**R1. Agents argue only with positions they submitted.**
The debate moderator prompt must receive each agent's `argument_set` and is explicitly told: "Never introduce political content not present in these sets." This is your most important ethical guardrail. Add a post-call audit: embed the moderator's `top_points` and check that at least 80% semantic overlap exists with union of agent submissions. If not, reject and retry.

**R2. Tension is a feature, not a failure.**
If `tension_coefficient > 0.6`, don't force consensus. Output a "live tension" state where both sides' strongest points are preserved verbatim. Manifesto should show these as "Contested" alongside "Resolved".

**R3. Minority views are protected.**
Any point that's been submitted by <20% of agents but has survived 3+ debate rounds without being rebutted on logic or evidence goes to a separate `minority_points` array. Render in the overlay with a cyan badge "Well-argued minority view".

**R4. Quality score per argument.**
Introduce `quality_score` on agents (0..1) computed each round: novelty (vs existing top_points) + survives-rebuttal (carried between rounds) + evidential (claims with citations score higher). Manifesto ordering = `agreement_pct * 0.5 + avg_quality * 0.5`. A minority voice with a 0.9 quality score ranks above a majority view at 0.5.

**R5. Transparent provenance.**
Every manifesto point stores `source_agent_ids[]`, `source_rounds[]`, and the prompt used to produce it. Tap an "i" icon -> drawer opens showing the trail. Habermas critique demands this.

**R6. Bounded cost + round scheduling.**
- First agent on a topic: store only, no debate call.
- Second agent: single moderator round against first (800 tokens cap).
- Third+ agent: debate against current `consensus_summary + top_points` only (never full history). Already in your plan.
- If 5 consecutive rounds change `agreement_pct` by less than 3%, freeze the node. Resume only when a new `argument_set` with quality_score > 0.7 arrives.

---

## Adversarial resilience: the one defense for day one

The attack you flagged (a well-funded org floods the arena with coordinated agents) is real and cheap to mount. You can't solve it fully, but you can make it uneconomic with these three cheap checks shipped from day one:

1. **Rate-limit per user.** An account can submit at most N new top-level arguments per topic per day. Anonymous accounts get a stricter N.
2. **Novelty filter.** New agents on an existing node must pass a Claude-check: "Does this add a new angle vs existing top_points?" If no, reject with "duplicate dissent, upvote the existing one instead". This alone kills 90% of mass-spam because the attacker has to produce genuinely varied content, which scales badly.
3. **Cluster-similarity cap.** If more than 3 agents arrive on a single node in a 5-minute window with >0.85 text similarity to each other (Claude-check), mark the node as "suspected brigade" and freeze debate. The incident goes into a moderation log that the profile page surfaces. Not a ban, a pause. Transparency beats policing.

These don't require embeddings, don't require captchas, and each is a few lines in `/api/submit`.

---

## Recommended order to ship (my call)

If we were to spend the next 2 hours on this, I'd do:

1. **Restore belief_updates in /api/chat + subscribe personal_arguments in Your View.** (30 min) This fixes the core loop. Without it, the app doesn't work.
2. **Wire LinkOverlay + line click + label pills on the lines.** (25 min) This is your biggest visual ask.
3. **Center the chat and rebuild the bubble stack with fade.** (15 min) Visual ask #2.
4. **Realtime subscribe to manifesto + agents + links in Arena.** (20 min) Arena stops feeling static.
5. **Rehook ManifestoBar to Supabase.** (15 min) Stops lying.
6. **Ambient empty-state prompt + [DISPUTED] pills.** (10 min) Two small but high-polish touches.
7. **R1 audit + R6 round caps in /api/debate.** (15 min) Budget + trust guardrails on.

Everything else (quality scores, provenance drawer, adversarial filters) is day-two work.

Tell me which of the seven to start on first and I'll begin.
