import {
  renderExperimentResultsCard,
  sampleResultsCard,
} from "back-end/src/services/slack/chartImage";

describe("renderExperimentResultsCard (smoke)", () => {
  // Exercises the full Satori + resvg-wasm pipeline, incl. loading the bundled
  // font and the resvg wasm — so it also guards against asset-bundling breakage.
  it("renders a valid PNG", async () => {
    const png = await renderExperimentResultsCard(sampleResultsCard());
    // PNG magic bytes.
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(2000);
  }, 30000);
});
