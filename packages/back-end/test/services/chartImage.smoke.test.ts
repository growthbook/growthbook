import {
  sampleCard,
  CardState,
  sampleScorecard,
  renderWeeklyScorecard,
  sampleFeatureDigest,
  renderFeatureDigest,
} from "back-end/src/services/slack/chartImage";
import { renderExperimentCard } from "back-end/src/services/slack/cards";

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

describe("renderExperimentCard (smoke)", () => {
  // Exercises the full Satori + resvg-wasm pipeline for every card state, incl.
  // loading the bundled fonts/logo and the resvg wasm — so it also guards
  // against asset-bundling breakage.
  it.each(STATES)(
    "renders a valid PNG for the %s state",
    async (state) => {
      const png = await renderExperimentCard(sampleCard(state));
      // PNG magic bytes.
      expect(isPng(png)).toBe(true);
      expect(png.length).toBeGreaterThan(2000);
    },
    30000,
  );
});

describe("renderDigest (smoke)", () => {
  // The digest previews render from these samples; guards the sample shapes
  // against the buildScorecard / buildFeatureDigest renderers.
  it("renders the experiment scorecard", async () => {
    const png = await renderWeeklyScorecard(sampleScorecard());
    expect(isPng(png)).toBe(true);
    expect(png.length).toBeGreaterThan(2000);
  }, 30000);

  it("renders the feature-flag digest", async () => {
    const png = await renderFeatureDigest(sampleFeatureDigest());
    expect(isPng(png)).toBe(true);
    expect(png.length).toBeGreaterThan(2000);
  }, 30000);
});
