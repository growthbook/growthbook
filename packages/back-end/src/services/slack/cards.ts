import {
  ExperimentCardData,
  renderDetailedCard,
  renderCompactCard,
} from "back-end/src/services/slack/chartImage";

// Experiment-card styles. A "card style" is one visual treatment for rendering
// an ExperimentCardData into a PNG. The data model is intentionally
// style-agnostic — every style consumes the same model — so adding a style is a
// new renderer + a `CARD_STYLES` entry, with no change to how cards are built.

export type ExperimentCardStyle = "detailed" | "compact";

export const DEFAULT_CARD_STYLE: ExperimentCardStyle = "detailed";

export interface CardStyleDefinition {
  id: ExperimentCardStyle;
  /** User-facing name (for a future picker UI / API). */
  label: string;
  /** One-line description of the look, for the same picker. */
  description: string;
  render: (exp: ExperimentCardData) => Promise<Buffer>;
}

const CARD_STYLES: Record<ExperimentCardStyle, CardStyleDefinition> = {
  detailed: {
    id: "detailed",
    label: "Detailed",
    description:
      "Full results table with per-variation posterior violin plots, " +
      "confidence intervals, hypothesis, conclusion, and health signals.",
    render: renderDetailedCard,
  },
  compact: {
    id: "compact",
    label: "Compact",
    description:
      "A glanceable single-hero-stat card for notifications — headline " +
      "metric, lift, chance-to-win, and a mini violin.",
    render: renderCompactCard,
  },
};

/**
 * Render an experiment card to a PNG, using the requested style (falling back
 * to the default when unset or unknown). This is the entry point all callers
 * should use — it keeps the choice of style in one place.
 */
export function renderExperimentCard(
  exp: ExperimentCardData,
  style: ExperimentCardStyle = DEFAULT_CARD_STYLE,
): Promise<Buffer> {
  const def = CARD_STYLES[style] ?? CARD_STYLES[DEFAULT_CARD_STYLE];
  return def.render(exp);
}

/** The available card styles, for a future user/org-facing picker. */
export function listCardStyles(): Omit<CardStyleDefinition, "render">[] {
  return Object.values(CARD_STYLES).map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
}
