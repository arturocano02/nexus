/*
  Relationship labelling + rendering helpers shared by server and client.
  Keep this tiny and pure so a rare server-side change doesn't force a
  client rebuild, and vice versa.
*/

export type RelationshipLabel =
  | "builds on"
  | "contradicts"
  | "clarifies"
  | "tangent"
  | "deepens"
  | "challenges";

export const RELATIONSHIP_LABELS: RelationshipLabel[] = [
  "builds on",
  "contradicts",
  "clarifies",
  "tangent",
  "deepens",
  "challenges",
];

// Single source of truth for arc colors. NodeMap reads these at render time.
// Kept in hex because Three.js and Tailwind both want that.
// Palette intentionally restricted to amber/cyan/violet/gray: no coral band,
// so the arena never reads as having a third "red" mood.
export function colorForRelationship(label?: string | null): string {
  switch (label) {
    case "builds on":
    case "deepens":
      return "#FFBF00"; // amber: constructive / reinforcing
    case "contradicts":
    case "challenges":
      return "#00DCFF"; // cyan: disagreement / opposition
    case "clarifies":
      return "#B892FF"; // violet: reframes / nuance
    case "tangent":
      return "#888780"; // neutral gray
    default:
      return "#888780"; // fallback to neutral gray so we never flash stray cyan
  }
}

// Spec: thickness = 0.5 + (similarity - 0.75) * 4  clamped [0.5, 1.5]
export function thicknessForSimilarity(similarity: number): number {
  const raw = 0.5 + (similarity - 0.75) * 4;
  return Math.min(1.5, Math.max(0.5, raw));
}
