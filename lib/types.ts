// Shared types across the Nexus app.

export type UUID = string;

export interface Excerpt {
  text: string;
  ts: string; // ISO timestamp
}

export interface PersonalArgument {
  id: UUID;
  user_id: UUID;
  topic_label: string;
  summary: string;
  raw_excerpts: Excerpt[];
  confidence_score: number;
  related_topics: string[];
  submitted: boolean;
  created_at: string;
  updated_at: string;
}

export interface DebateLogEntry {
  agent_id: UUID;
  text: string;
  is_anonymous: boolean;
  display_name?: string;
  ts: string;
}

export interface PublicNode {
  id: UUID;
  topic_label: string;
  consensus_summary: string;
  is_resolved: boolean;
  agreement_pct: number;
  tension_coefficient: number;
  noise_saturation: number;
  debate_log: DebateLogEntry[];
  top_points: string[];
  is_debating: boolean;
  created_at: string;
  updated_at: string;
}

export interface ManifestoPoint {
  id: UUID;
  point_text: string;
  agreement_pct: number;
  confidence_score: number;
  source_node_id: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface BeliefUpdate {
  topic_label: string;
  summary: string;
  confidence_score: number; // 0..1
  related_topics: string[];
  excerpt?: string; // user utterance that produced this update
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
  particle_direction: 'a_to_b' | 'b_to_a';
  link_summary?: string;
  is_user_confirmed: boolean;
  // Live link engine fields (all optional because some rows predate them).
  relationship_label?: RelationshipLabel | null;
  arc_color?: string | null;
  arc_thickness?: number | null;
  animated_in?: boolean;
  last_seen_at?: string;
}
