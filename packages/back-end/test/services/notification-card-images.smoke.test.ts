import { buildNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { renderCard } from "back-end/src/services/notificationCards/cardStyles";
import { notificationCardSamples } from "./notificationCard.fixtures";

const isPng = (png: Buffer) =>
  png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";

const cardFor = (name: string) => {
  const sample = notificationCardSamples.find((s) => s.name === name);
  const card = sample && buildNotificationCard(sample.event);
  if (!card) throw new Error(`Missing ${name} sample card`);
  return card.data;
};

describe("notification card rendering", () => {
  it.each(notificationCardSamples)(
    "renders light and dark $name cards from the event payload",
    async ({ event }) => {
      const card = buildNotificationCard(event);
      expect(card).not.toBeNull();
      if (!card) throw new Error("Missing event sample card");
      for (const section of card.data.sections) {
        if (section.kind === "results") {
          expect(section.results.rows.length).toBeGreaterThan(0);
        }
      }
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

  it("renders dark without changing concurrent light renders", async () => {
    const card = cardFor("stopped-winner");
    const lightBefore = await renderCard(card, "light");
    const [dark, light] = await Promise.all([
      renderCard(card, "dark"),
      renderCard(card, "light"),
    ]);
    expect(dark.readUInt32BE(20)).toBe(light.readUInt32BE(20));
    expect(dark.equals(light)).toBe(false);
    expect(light.equals(lightBefore)).toBe(true);
  }, 30000);
});
