import type { NotificationEvent } from "shared/types/events/notification-events";

// A card plus the plain-text metadata deliveries need, derived from the card
// data and the event in buildNotificationCard.
export interface NotificationCard {
  data: CardData;
  // Plain text: file title / alt text.
  altText: string;
  objectUrl: string;
  objectName: string;
  // For the caption's "Owner:" part; absent on events recorded before the
  // owner was captured.
  ownerEmail?: string;
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
  v: string; // row name
  i: number; // row index (number circle)
  stat?: string; // the headline stat, already formatted: "99.1%", "<0.001"
  chg?: string; // "+6.1%"
  dir?: "up" | "down"; // arrow: the sign of the change
  // Whether the change is in the desired direction (a drop in an inverse
  // metric is good). Colors the stat and change; defaults to `dir`.
  good?: boolean;
  // Distribution drawn against the section's axis: center and spread, in the
  // same units as the axis domain.
  vio?: { c: number; s: number };
  // Interval bounds under the distribution, already formatted: "[+6%, +14%]".
  // Named once for the table by `CardResults.intervalLabel`.
  interval?: string;
  // Significance of `stat`. Colors the stat and change together with `good`;
  // an unknown significance renders muted.
  sig: boolean;
  muted?: boolean;
}

// A results table: one numbered row per variation, under the measure's name.
export interface CardResults {
  sectionLabel: string; // caps label above the title, e.g. "Goal metric"
  title: string; // what the rows measure, e.g. the metric name
  statLabel: string; // column header for `stat`; the producer names the stat
  changeLabel: string; // column header for `chg`, e.g. "Lift"
  intervalLabel?: string; // column header for `interval`, e.g. "95% Credible Interval"
  rows: CardResultRow[];
  // Line under the rows, e.g. "+2 more variations" when the producer capped them.
  note?: string;
  // One axis shared by every row's distribution, so the rows read against each
  // other: the numeric domain `vio` is measured in, plus the labels to print
  // at its minimum, zero, and maximum. Omitted when no row has a distribution.
  axis?: { domain: [number, number]; labels: [string, string, string] };
}

// A card body is an ordered list of sections, so a new card picks the sections
// it needs instead of adding a shape the renderer has to branch on.
export type CardSection =
  | { kind: "fields"; fields: CardField[] }
  | { kind: "table"; table: CardTable }
  | { kind: "callout"; callout: CardCallout }
  | { kind: "results"; results: CardResults }
  // Side by side, so a card grows sideways instead of down: chat clients fit
  // images to a landscape box and shrink tall ones. The left column is narrow.
  | { kind: "columns"; left: CardSection[]; right: CardSection[] };

export interface CardData extends CardIdentity {
  sections: CardSection[];
}
