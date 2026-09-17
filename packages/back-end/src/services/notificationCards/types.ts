import type { NotificationEvent } from "shared/types/events/notification-events";

// A card plus the plain-text metadata deliveries need, all derived from the
// card data in buildNotificationCard.
export interface NotificationCard {
  data: CardData;
  // Plain text: file title / alt text.
  altText: string;
  objectUrl: string;
  objectName: string;
  eventLabel: string;
}

// Producers turn an immutable event payload into card data.
export type NotificationCardProducer = (
  event: NotificationEvent,
) => CardData | null;

// How a card reads at a glance. Producers map their own outcome onto a tone (a
// won experiment is `success`); the renderer turns the tone into a color.
export type CardTone = "info" | "success" | "danger" | "neutral" | "warning";

// The banner glyph. Chosen independently of tone so a producer can pair, say, a
// trophy with a neutral card.
export type CardIcon = "play" | "check" | "trophy" | "x" | "stop" | "warn";

// Header/footer fields shared by every card.
export interface CardIdentity {
  tone: CardTone;
  icon: CardIcon;
  name: string;
  // Headline for the full-width banner in the card's tone color.
  banner: string;
  // Standard footer, already formatted: the producer owns the wording.
  footer?: string;
  // Where the card's object lives, for the delivery message's link.
  url: string;
}

// A labeled value, rendered as a small caps label with the value beneath it —
// the same label-over-value treatment the results tables and callouts use.
export interface CardField {
  label: string;
  value: string;
}

export interface CardTable {
  columns: string[];
  rows: string[][];
  note?: string;
}

// Prose featured near the top of a card on a soft tone-colored background,
// under a caps label. `aside` is a second labeled block below the first.
export interface CardCallout {
  label: string;
  markdown: string;
  aside?: { label: string; markdown: string };
}

export interface CardResultRow {
  v: string; // variation name
  i: number; // variation index (number circle)
  ctw?: string; // "99.1%"
  chg?: string; // "+6.1%"
  dir?: "up" | "down"; // arrow: the sign of the change
  // Whether the change is in the metric's desired direction (a drop in an
  // inverse metric is good). Colors the stat and lift; defaults to `dir`.
  good?: boolean;
  vio?: { c: number; s: number }; // violin center (lift %) + spread
  ci?: { lo: number; hi: number; pt: number };
  // Significance of the stat in `ctw` (chance to win, or p-value for
  // frequentist tests). Colors the stat and lift together with `good`; an
  // unknown significance renders muted.
  sig: boolean;
  muted?: boolean;
}

// A results table: one numbered row per variation, under the measure's name.
export interface CardResults {
  sectionLabel: string; // caps label above the title, e.g. "Goal metric"
  title: string; // what the rows measure, e.g. the metric name
  statLabel: string; // column header for `ctw`; the producer names the stat
  rows: CardResultRow[];
}

// A card body is an ordered list of sections, so a new card picks the sections
// it needs instead of adding a shape the renderer has to branch on.
export type CardSection =
  | { kind: "fields"; fields: CardField[] }
  | { kind: "table"; table: CardTable }
  | { kind: "callout"; callout: CardCallout }
  | { kind: "results"; results: CardResults };

export interface CardData extends CardIdentity {
  sections: CardSection[];
}
