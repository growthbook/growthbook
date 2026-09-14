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
  ctrl: string;
  vr: string;
  cn?: string;
  vn?: string;
  ctw?: string; // "99.1%"
  chg?: string; // "+6.1%"
  dir?: "up" | "down";
  vio?: { c: number; s: number }; // violin center (lift %) + spread
  ci?: { lo: number; hi: number; pt: number };
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
  dates?: string;
  badgeLabel?: string; // overrides the state badge text, e.g. a stopped card with no outcome
}

// Built from an immutable event payload alone; carries no metric results.
export interface EventCardData extends CardIdentity {
  summary: string[];
  table?: CardTable;
}

// Results card: adds snapshot-derived metric data. Not produced by any event
// yet; kept for the upcoming stopped/won/lost cards.
export interface ExperimentCardData extends CardIdentity {
  goal: string;
  variants: string[];
  users?: string;
  days?: string;
  ds?: string;
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
  compactLine?: string; // one-line conclusion fallback for outcome events
}

export type CardData = EventCardData | ExperimentCardData;
