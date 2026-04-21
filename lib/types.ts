// Shared types across the Nexo app.

export type UUID = string;

// -----------------------------------------------------------------------
// Auth / user
// -----------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// -----------------------------------------------------------------------
// Taxonomy (backend structure, never shown to user)
// -----------------------------------------------------------------------

export interface TaxonomyCategory {
  id: UUID;
  slug: string;
  name: string;
  sort_order: number;
  opening_question: string | null;
  created_at: string;
}

export interface TaxonomySubtopic {
  id: UUID;
  category_id: UUID;
  slug: string;
  name: string;
  is_other: boolean;
  sort_order: number;
  latent_question_text: string | null;
  latent_question_yes_label: string | null;
  latent_question_no_label: string | null;
  created_at: string;
}

export interface TaxonomyQuestion {
  id: UUID;
  subtopic_id: UUID;
  depth_layer: 1 | 2 | 3;
  question_text: string;
  yes_next_id: UUID | null;
  no_next_id: UUID | null;
}

// -----------------------------------------------------------------------
// Messages — one row per conversation turn in DB
// -----------------------------------------------------------------------

export interface Message {
  id: UUID;
  user_id: UUID;
  session_id: string;
  category_id: UUID | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// -----------------------------------------------------------------------
// Inferred positions — AI-extracted stance per user+subtopic
// -----------------------------------------------------------------------

export interface InferredPosition {
  id: UUID;
  user_id: UUID;
  session_id: string;
  category_id: UUID | null;
  subtopic_id: UUID | null;
  stance: "yes" | "no" | "abstain" | "unclear" | null;
  confidence: number; // 0..1
  reasoning: string | null;
  arguments_json: ArgumentEntry[];
  weight_d: number | null;
  weight_q: number | null;
  weight_c: number | null;
  weight_total: number | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------
// Conversation state (legacy V1 — kept for submit route compatibility)
// -----------------------------------------------------------------------

export interface ArgumentEntry {
  text: string;
  ts: string; // ISO timestamp
}

/** One row in public.conversations — one question answered per session. */
export interface Conversation {
  id: UUID;
  user_id: UUID;
  session_id: string;
  category_id: UUID | null;
  subtopic_id: UUID | null;
  question_text: string | null;
  question_depth: 1 | 2 | 3;
  stance: "yes" | "no" | "abstain" | "unclear" | null;
  arguments_json: ArgumentEntry[];
  weight_d: number | null;
  weight_q: number | null;
  weight_c: number | null;
  weight_total: number | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------
// Review screen
// -----------------------------------------------------------------------

export interface ReviewItem {
  /** Maps to inferred_positions.id */
  position_id: UUID;
  category_id: UUID;
  category_name: string;
  subtopic_id: UUID;
  subtopic_name: string;
  stance: "yes" | "no" | "abstain" | "unclear" | null;
  confidence: number;
  reasoning: string | null;
  arguments: ArgumentEntry[];
  weight_d: number | null;
  weight_q: number | null;
  weight_c: number | null;
  weight_total: number | null;
}

// -----------------------------------------------------------------------
// Collective scores / arena output
// -----------------------------------------------------------------------

export interface CollectiveScore {
  subtopic_id: UUID;
  category_id: UUID | null;
  total_responses: number;
  yes_weighted_pct: number;
  no_weighted_pct: number;
  abstain_count: number;
  tension_flag: "agreed" | "contested" | "disputed" | "hot";
  top_yes_args: string[];
  top_no_args: string[];
  computed_at: string;
}

export interface CategoryAggregate {
  category_id: UUID;
  category_slug: string;
  category_name: string;
  total_responses: number;
  yes_weighted_pct: number;
  no_weighted_pct: number;
  abstain_count: number;
  tension_flag: "agreed" | "contested" | "disputed" | "hot";
  top_yes_args: string[];
  top_no_args: string[];
  subtopics: SubtopicAggregate[];
}

export interface SubtopicAggregate {
  subtopic_id: UUID;
  subtopic_name: string;
  yes_weighted_pct: number;
  no_weighted_pct: number;
  abstain_count: number;
  tension_flag: "agreed" | "contested" | "disputed" | "hot";
  total_responses: number;
}

// -----------------------------------------------------------------------
// Globe (NodeMap props shape)
// -----------------------------------------------------------------------

export interface MapNodeDatum {
  id: string;
  label: string;
  weight: number;
  conviction: number; // 0..1
  pulsing?: boolean;
  isOwn?: boolean;
  tension?: number;
  /** Override blob color (for arena green/amber/red coloring) */
  hexColor?: string;
}

// -----------------------------------------------------------------------
// Links (arcs between globe nodes)
// -----------------------------------------------------------------------

export type RelationshipLabel =
  | "builds on"
  | "contradicts"
  | "clarifies"
  | "tangent"
  | "deepens"
  | "challenges";

export interface Link {
  id: UUID;
  node_a_id: UUID;
  node_b_id: UUID;
  similarity_score: number;
  particle_direction: "a_to_b" | "b_to_a";
  link_summary?: string;
  is_user_confirmed: boolean;
  relationship_label?: RelationshipLabel | null;
  arc_color?: string | null;
  arc_thickness?: number | null;
  animated_in?: boolean;
  last_seen_at?: string;
}

// -----------------------------------------------------------------------
// Chat API request/response shapes
// -----------------------------------------------------------------------

export interface ChatRequest {
  messages: ChatMessage[];
  session_id: string;
  category_id: string | null;
  category_slug: string | null;
}

/** Streamed SSE event types */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "classified"; subtopic_id: string; subtopic_name: string; confidence: number }
  | { type: "error"; message: string };
