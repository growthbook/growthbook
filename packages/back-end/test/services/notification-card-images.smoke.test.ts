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
      expect(png.readUInt32BE(16)).toBe(2000);
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
      expect(png.readUInt32BE(16)).toBe(1120);
      expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(480);
    },
    30000,
  );
});

it.each(STATES)(
  "renders compact dark %s without changing concurrent light renders",
  async (state) => {
    const card = sampleCard(state);
    const lightBefore = await renderExperimentCard(card, "compact");
    const [dark, light] = await Promise.all([
      renderExperimentCard(card, "compact-dark"),
      renderExperimentCard(card, "compact"),
    ]);
    expect(isPng(dark)).toBe(true);
    expect(dark.readUInt32BE(16)).toBe(1120);
    expect(dark.readUInt32BE(20)).toBe(light.readUInt32BE(20));
    expect(dark.equals(light)).toBe(false);
    expect(light.equals(lightBefore)).toBe(true);
  },
  30000,
);
