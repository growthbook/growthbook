import { buildNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import type { CardState } from "back-end/src/services/notificationCards/types";
import { sampleCard } from "back-end/src/services/notificationCards/cardImages";
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

describe("renderCard", () => {
  it.each(STATES)(
    "renders a light PNG for the %s state",
    async (state) => {
      const png = await renderCard(sampleCard(state), "light");
      expect(isPng(png)).toBe(true);
      expect(png.length).toBeGreaterThan(2000);
      expect(png.readUInt32BE(16)).toBe(2000);
    },
    30000,
  );

  it.each(STATES)(
    "renders dark %s without changing concurrent light renders",
    async (state) => {
      const card = sampleCard(state);
      const lightBefore = await renderCard(card, "light");
      const [dark, light] = await Promise.all([
        renderCard(card, "dark"),
        renderCard(card, "light"),
      ]);
      expect(isPng(dark)).toBe(true);
      expect(dark.readUInt32BE(16)).toBe(2000);
      expect(dark.readUInt32BE(20)).toBe(light.readUInt32BE(20));
      expect(dark.equals(light)).toBe(false);
      expect(light.equals(lightBefore)).toBe(true);
    },
    30000,
  );
});

describe("immutable event card rendering", () => {
  it.each(notificationCardSamples)(
    "renders light and dark $name cards from the event payload",
    async ({ event }) => {
      const card = buildNotificationCard(event);
      expect(card).not.toBeNull();
      if (!card) throw new Error("Missing event sample card");
      if ("rows" in card.data) expect(card.data.rows.length).toBeGreaterThan(0);
      for (const format of ["light", "dark"] as const) {
        const png = await renderCard(card.data, format);
        expect(isPng(png)).toBe(true);
        expect(png.readUInt32BE(16)).toBe(2000);
        expect(png.readUInt32BE(20)).toBeGreaterThan(150);
        expect(png.length).toBeGreaterThan(2000);
      }
    },
    30000,
  );
});
