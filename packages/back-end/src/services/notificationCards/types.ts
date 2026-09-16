import type { NotificationEvent } from "shared/types/events/notification-events";

export interface NotificationCard {
  data: CardData;
  // Plain text: file title / alt text.
  altText: string;
  objectUrl: string;
  objectName: string;
  eventLabel: string;
}

export type NotificationCardProducer = (
  event: NotificationEvent,
) => NotificationCard | null;

export type CardState =
  | "started"
  | "running"
  | "winner"
  | "loser"
  | "stopped"
  | "warning";

// A compact notification announces an EVENT (distinct from the experiment's
// status). started fires while Running; won/lost/stopped once
// Stopped; warning is a health alert.
export type CompactEvent = "started" | "won" | "lost" | "stopped" | "warning";

export interface CardGoalRow {
  v: string; // variation name
  i: number; // variation index (number circle)
  ctrl?: string; // control mean, formatted
  vr?: string; // variation mean, formatted
  cn?: string;
  vn?: string;
  ctw?: string; // "99.1%"
  chg?: string; // "+6.1%"
  dir?: "up" | "down";
  vio?: { c: number; s: number }; // violin center (lift %) + spread
  ci?: { lo: number; hi: number; pt: number };
  // Significance of the stat in `ctw` (chance to win, or p-value for
  // frequentist tests). Drives the stat color together with `dir`.
  sig?: boolean;
  muted?: boolean;
}

export interface CardCiMetric {
  name: string;
  ctrl: string;
  vr: string;
  chg?: string;
  dir?: "up" | "down";
  ci: { lo: number; hi: number; pt: number };
  sig?: boolean;
}

export interface CardTable {
  columns: string[];
  rows: string[][];
  note?: string;
}

// Header/footer fields shared by every card.
export interface CardIdentity {
  state: CardState;
  // The notification *event* the card announces (distinct from `state`/status).
  // When unset, the compact card derives it from state.
  event?: CompactEvent;
  name: string;
  key: string;
  tags?: string[];
  // Standard footer: "{units} units - {days} days", whichever parts are known.
  units?: number;
  durationDays?: number;
  badgeLabel?: string; // overrides the state badge text, e.g. a stopped card with no outcome
  // Headline for a full-width banner in the card's state color. When set, the
  // detailed card drops the state badge and the compact banner reuses the text.
  banner?: string;
}

// A labeled value, rendered as a small caps label with the value beneath it —
// the same label-over-value treatment the results tables and conclusion use.
export interface CardField {
  label: string;
  value: string;
}

// Built from an immutable event payload alone; carries no metric results.
export interface EventCardData extends CardIdentity {
  fields?: CardField[];
  table?: CardTable;
}

// Results card: adds snapshot-derived metric data. Not produced by any event
// yet; kept for the upcoming stopped/won/lost cards.
export interface ExperimentCardData extends CardIdentity {
  goal: string;
  variants: string[];
  note?: string;
  rows: CardGoalRow[];
  secondary?: CardCiMetric[];
  guardrail?: CardCiMetric[];
  // Shown above the conclusion for non-started states; and in the started body.
  hypothesis?: string;
  // Completed experiments (won / lost / stopped) with a written analysis.
  conclusion?: { text: string };
  // Orthogonal to state — an experiment can be Running or Won and still be
  // flagged unhealthy. Renders a red banner under the header when unhealthy.
  health?: { status: "healthy" | "unhealthy"; issues: [string, string][] };
  // started-only
  metrics?: { goal: string; secondary: string[]; guardrail: string[] };
  // warning-only
  srm?: string;
  p?: string;
  winningVariation?: string;
  winningVariationIndex?: number;
  // Labels the stat column: "Chance" for bayesian, "P-value" for frequentist.
  statsEngine?: "bayesian" | "frequentist";
  compactLine?: string; // one-line conclusion fallback for outcome events
}

export type CardData = EventCardData | ExperimentCardData;
