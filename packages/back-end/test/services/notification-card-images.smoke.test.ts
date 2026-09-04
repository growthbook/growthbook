import {
  type CardState,
  type CompactEvent,
  sampleCard,
} from "back-end/src/services/notificationCards/cardImages";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";

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
