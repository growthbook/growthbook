import { buildExperimentSrmCard } from "back-end/src/services/notificationCards/producers/experimentSrmCard";
import {
  type CardState,
  type CompactEvent,
  sampleCard,
} from "back-end/src/services/notificationCards/cardImages";
import { renderCard } from "back-end/src/services/notificationCards/cardStyles";
import { notificationCardSamples } from "./notificationCard.fixtures";

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

describe("renderCard", () => {
  it.each(STATES)(
    "renders a detailed PNG for the %s state",
    async (state) => {
      const png = await renderCard(sampleCard(state), "detailed");
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
      const png = await renderCard(card, "compact");
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
    const lightBefore = await renderCard(card, "compact");
    const [dark, light] = await Promise.all([
      renderCard(card, "compact-dark"),
      renderCard(card, "compact"),
    ]);
    expect(isPng(dark)).toBe(true);
    expect(dark.readUInt32BE(16)).toBe(1120);
    expect(dark.readUInt32BE(20)).toBe(light.readUInt32BE(20));
    expect(dark.equals(light)).toBe(false);
    expect(light.equals(lightBefore)).toBe(true);
  },
  30000,
);

describe("immutable event summary rendering", () => {
  it.each(notificationCardSamples)(
    "renders compact and detailed $name cards without metric data",
    async ({ event }) => {
      const card = buildExperimentSrmCard(event);
      expect(card).not.toBeNull();
      if (!card) throw new Error("Missing event sample card");
      expect(card.data).not.toHaveProperty("rows");
      for (const style of ["compact", "compact-dark", "detailed"] as const) {
        const png = await renderCard(card.data, style);
        expect(isPng(png)).toBe(true);
        expect(png.readUInt32BE(16)).toBeGreaterThan(500);
        expect(png.readUInt32BE(20)).toBeGreaterThan(150);
        expect(png.length).toBeGreaterThan(2000);
      }
    },
    30000,
  );
});
