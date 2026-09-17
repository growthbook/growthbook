import type { NotificationEvent } from "shared/types/events/notification-events";
import type { StatsEngine } from "shared/types/stats";

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

export type CardState = "started" | "winner" | "loser" | "stopped" | "warning";

// The EVENT a card announces (distinct from the experiment's status), derived
// from the card state: started fires while Running; won/lost/stopped once
// Stopped; warning is a health alert.
export type CardEvent = "started" | "won" | "lost" | "stopped" | "warning";

export interface CardGoalRow {
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

export interface CardTable {
  columns: string[];
  rows: string[][];
  note?: string;
}

// Header/footer fields shared by every card.
export interface CardIdentity {
  state: CardState;
  name: string;
  key: string;
  // Standard footer: "{units} units - {days} days", whichever parts are known.
  units?: number;
  durationDays?: number;
  // Headline for the full-width banner in the card's state color.
  banner: string;
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

// Results card: the goal metric's per-variation results from the stop payload.
export interface ExperimentCardData extends CardIdentity {
  goal: string;
  rows: CardGoalRow[];
  // Completed experiments (won / lost / stopped): the written analysis and,
  // when one is active, the variation a temporary rollout serves.
  conclusion?: { text?: string; rollout?: string };
  // Picks the stat column label: chance to win, or p-value for frequentist.
  statsEngine?: StatsEngine;
}

export type CardData = EventCardData | ExperimentCardData;
