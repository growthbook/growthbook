import { buildEventSnapshotCard } from "back-end/src/services/notificationCards/eventSnapshotCard";
import {
  type CardState,
  type CompactEvent,
  sampleCard,
} from "back-end/src/services/notificationCards/cardImages";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { eventSnapshotCardSamples } from "./eventSnapshotCard.fixtures";

const isPng = (png: Buffer) =>
  png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";

const STATES: CardState[] = [
  "started",
  "running",
  "winner",
  "loser",
  "stopped",
  "warning",
];

const COMPACT_EVENTS: { event: CompactEvent; state: CardState }[] = [
  { event: "started", state: "started" },
  { event: "significance", state: "running" },
  { event: "won", state: "winner" },
  { event: "lost", state: "loser" },
  { event: "stopped", state: "stopped" },
  { event: "warning", state: "warning" },
];

describe("renderExperimentCard", () => {
  it.each(STATES)(
    "renders a detailed PNG for the %s state",
    async (state) => {
      const png = await renderExperimentCard(sampleCard(state));
      expect(isPng(png)).toBe(true);
      expect(png.length).toBeGreaterThan(2000);
    },
    30000,
  );

  it.each(COMPACT_EVENTS)(
    "renders a compact PNG for the $event event",
    async ({ event, state }) => {
      const card = sampleCard(state);
      card.event = event;
      const png = await renderExperimentCard(card, "compact");
      expect(isPng(png)).toBe(true);
      expect(png.length).toBeGreaterThan(2000);
    },
    30000,
  );
});

describe("immutable event summary rendering", () => {
  it.each(eventSnapshotCardSamples)(
    "renders compact and detailed $name cards without result rows",
    async ({ event }) => {
      const card = buildEventSnapshotCard(event);
      expect(card).not.toBeNull();
      if (!card) throw new Error("Missing event sample card");
      expect(card.rows).toEqual([]);
      for (const style of ["compact", "detailed"] as const) {
        const png = await renderExperimentCard(card, style);
        expect(isPng(png)).toBe(true);
        expect(png.readUInt32BE(16)).toBeGreaterThan(500);
        expect(png.readUInt32BE(20)).toBeGreaterThan(150);
        expect(png.length).toBeGreaterThan(2000);
      }
    },
    30000,
  );
});
