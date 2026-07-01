import {
  renderExperimentCard,
  sampleCard,
  CardState,
} from "back-end/src/services/slack/chartImage";

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
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.length).toBeGreaterThan(2000);
    },
    30000,
  );
});
