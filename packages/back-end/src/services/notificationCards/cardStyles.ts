import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationCardFormat,
} from "shared/validators";
import {
  CardData,
  renderDetailedCard,
  renderCompactCard,
  renderCompactDarkCard,
} from "back-end/src/services/notificationCards/cardImages";

// A card style is one platform-neutral visual treatment for rendering
// CardData into a PNG. The data model is intentionally style-agnostic — every
// style consumes the same model — so adding a style is purely a new renderer +
// registry entry, with no change to how cards are built from an event.

export interface CardStyleDefinition {
  id: NotificationCardFormat;
  /** User-facing name (for a future picker UI / API). */
  label: string;
  /** One-line description of the look, for the same picker. */
  description: string;
  render: (card: CardData) => Promise<Buffer>;
}

const CARD_STYLES: Record<NotificationCardFormat, CardStyleDefinition> = {
  "compact-dark": {
    id: "compact-dark",
    label: "Compact dark",
    description:
      "A compact card with a dark background and the same colored event header.",
    render: renderCompactDarkCard,
  },
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
 * Render a card to a PNG in the requested style (falling back to the default
 * when unset or unknown). This is the entry point all callers should use — it
 * keeps the choice of style in one place.
 */
export function renderCard(
  card: CardData,
  style: NotificationCardFormat = DEFAULT_NOTIFICATION_SETTINGS.cardFormat,
): Promise<Buffer> {
  const def =
    CARD_STYLES[style] ?? CARD_STYLES[DEFAULT_NOTIFICATION_SETTINGS.cardFormat];
  return def.render(card);
}

/** The available card styles, for a future user/org-facing picker. */
export function listCardStyles(): Omit<CardStyleDefinition, "render">[] {
  return Object.values(CARD_STYLES).map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
}
