import { normCdf, randomNormal } from "../src/utils";

describe("normCdf", () => {
  it("matches known standard-normal values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normCdf(-1.959964)).toBeCloseTo(0.025, 5);
  });
});

describe("randomNormal", () => {
  it("produces samples whose mean and variance match the target", () => {
    const mu = 3;
    const sigma = Math.sqrt(2);
    const nSamples = 1_000_000;

    const samples = randomNormal(nSamples, mu, sigma);
    const mean = samples.reduce((s, x) => s + x, 0) / nSamples;
    const variance =
      samples.reduce((s, x) => s + (x - mean) ** 2, 0) / (nSamples - 1);

    expect(mean).toBeCloseTo(mu, 1);
    expect(variance).toBeCloseTo(sigma * sigma, 1);
  }, 30000);
});
