import { GrowthBook } from "../src";
import { persistRedirectExposures } from "../src/redirect-exposure";
import type { AutoExperiment, TrackingCallback } from "../src/types/growthbook";

const STORAGE_KEY = "gb_redirect_exposure";
const ORIGIN = "http://www.example.com/home";
const DESTINATION = "http://www.example.com/home-new";

const redirectExperiment: AutoExperiment = {
  key: "my-experiment",
  urlPatterns: [{ type: "simple", include: true, pattern: ORIGIN }],
  weights: [0, 1],
  variations: [{}, { urlRedirect: DESTINATION }],
};

function buildGrowthBook(
  trackingCallback: TrackingCallback,
  url = ORIGIN,
  experiments: AutoExperiment[] = [redirectExperiment],
) {
  // Wrapped after construction, before the payload arrives, as the wrapper does
  const gb = new GrowthBook({
    attributes: { id: "1" },
    url,
    trackingCallback,
    navigate: () => {},
  });
  persistRedirectExposures(gb);
  gb.initSync({ payload: { experiments } });
  return gb;
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

describe("persistRedirectExposures", () => {
  afterEach(() => localStorage.clear());

  it("persists a redirect exposure whose tracking callback gives no confirmation", async () => {
    const gb = buildGrowthBook(() => {});
    await settle();

    expect(stored()).toEqual(
      expect.objectContaining({
        url: ORIGIN,
        experiment: expect.objectContaining({ key: "my-experiment" }),
        result: expect.objectContaining({ inExperiment: true, variationId: 1 }),
      }),
    );
    gb.destroy();
  });

  it("drops the persisted exposure once the tracker confirms it", async () => {
    const gb = buildGrowthBook(() => Promise.resolve());
    await settle();

    expect(stored()).toBeNull();
    gb.destroy();
  });

  it("replays the exposure on the destination page, then clears it", async () => {
    const origin = buildGrowthBook(() => {});
    await settle();
    origin.destroy();

    const replayed = jest.fn();
    const destination = buildGrowthBook(replayed, DESTINATION, []);
    await settle();

    expect(replayed).toHaveBeenCalledTimes(1);
    expect(replayed.mock.calls[0][0]).toEqual(
      expect.objectContaining({ key: "my-experiment" }),
    );
    expect(replayed.mock.calls[0][1]).toEqual(
      expect.objectContaining({ variationId: 1 }),
    );
    expect(stored()).toBeNull();
    destination.destroy();
  });

  it("does not replay on the same page or after the exposure has gone stale", async () => {
    const origin = buildGrowthBook(() => {});
    await settle();
    origin.destroy();

    const samePage = jest.fn();
    buildGrowthBook(samePage, ORIGIN, []).destroy();
    expect(samePage).not.toHaveBeenCalled();

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...stored(), date: Date.now() - 61_000 }),
    );
    const stale = jest.fn();
    buildGrowthBook(stale, DESTINATION, []).destroy();
    expect(stale).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it("ignores exposures for experiments that don't redirect", async () => {
    const gb = buildGrowthBook(() => {}, ORIGIN, [
      { ...redirectExperiment, variations: [{}, {}] },
    ]);
    await settle();

    expect(stored()).toBeNull();
    gb.destroy();
  });
});
