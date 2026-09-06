import type {
  BeliefKind,
  BeliefScope,
  Confidence,
  RelationKind,
} from "./types";

export const BELIEF_KINDS: BeliefKind[] = [
  "axiom",
  "doctrine",
  "principle",
  "practice",
];

export const KIND_META: Record<
  BeliefKind,
  { label: string; plural: string; color: string; hint: string }
> = {
  axiom: {
    label: "Axiom",
    plural: "Axioms",
    color: "#5E35B1",
    hint: "A presupposition the rest is built on",
  },
  doctrine: {
    label: "Doctrine",
    plural: "Doctrines",
    color: "#1E88E5",
    hint: "A formulated teaching about God, humanity, or salvation",
  },
  principle: {
    label: "Principle",
    plural: "Principles",
    color: "#00897B",
    hint: "A guiding rule derived from doctrine",
  },
  practice: {
    label: "Practice",
    plural: "Practices",
    color: "#43A047",
    hint: "A concrete command or habit",
  },
};

export const BELIEF_SCOPES: BeliefScope[] = ["general", "specific"];

export const SCOPE_META: Record<
  BeliefScope,
  { label: string; hint: string }
> = {
  general: {
    label: "General",
    hint: "Broad — shapes many other beliefs",
  },
  specific: {
    label: "Specific",
    hint: "Narrow — a particular case or application",
  },
};

export const CONFIDENCE_MIN: Confidence = 1;
export const CONFIDENCE_MAX: Confidence = 10;

export function clampConfidence(n: number): Confidence {
  const c = Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Math.round(n)));
  return c as Confidence;
}

/** Traffic-light colour for a confidence score. */
export function confidenceColor(c: Confidence): string {
  if (c >= 8) return "#2E7D32";
  if (c >= 5) return "#F9A825";
  return "#C62828";
}

export function confidenceLabel(c: Confidence): string {
  if (c >= 9) return "Bedrock";
  if (c >= 7) return "Confident";
  if (c >= 5) return "Leaning";
  if (c >= 3) return "Unsure";
  return "Doubtful";
}

export const RELATION_KINDS: RelationKind[] = [
  "grounds",
  "implies",
  "applies",
  "qualifies",
  "tension",
];

export const RELATION_META: Record<
  RelationKind,
  {
    label: string;
    /** Verb phrase for "A ___ B". */
    verb: string;
    color: string;
    dashed: boolean;
    /** Tension is symmetric; draw an arrow on both ends. */
    bidirectional: boolean;
  }
> = {
  grounds: {
    label: "Grounds",
    verb: "grounds",
    color: "#5E35B1",
    dashed: false,
    bidirectional: false,
  },
  implies: {
    label: "Implies",
    verb: "implies",
    color: "#1E88E5",
    dashed: false,
    bidirectional: false,
  },
  applies: {
    label: "Applied in",
    verb: "is applied in",
    color: "#43A047",
    dashed: false,
    bidirectional: false,
  },
  qualifies: {
    label: "Qualifies",
    verb: "qualifies",
    color: "#8D6E63",
    dashed: true,
    bidirectional: false,
  },
  tension: {
    label: "In tension",
    verb: "is in tension with",
    color: "#E53935",
    dashed: true,
    bidirectional: true,
  },
};

/** Palette for cluster backgrounds; cycled as groups are created. */
export const CLUSTER_COLORS = [
  "#1E88E5",
  "#43A047",
  "#F4511E",
  "#8E24AA",
  "#00897B",
  "#6D4C41",
  "#3949AB",
  "#C0CA33",
];

/** `#RRGGBB` + alpha in [0,1] -> `rgba(...)`. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
