import {
  coverageToHoldoutSize,
  holdoutSizeToCoverage,
  MAX_HOLDOUT_SIZE,
} from "../src/validators/holdout";

describe("holdout size / coverage conversion", () => {
  it("doubles holdoutSize to get the stored coverage", () => {
    expect(holdoutSizeToCoverage(0.05)).toBe(0.1);
    expect(holdoutSizeToCoverage(0.5)).toBe(1);
    expect(holdoutSizeToCoverage(0)).toBe(0);
  });

  it("halves stored coverage to get holdoutSize", () => {
    expect(coverageToHoldoutSize(0.1)).toBe(0.05);
    expect(coverageToHoldoutSize(1)).toBe(0.5);
    expect(coverageToHoldoutSize(0)).toBe(0);
  });

  it("caps out at exactly full coverage", () => {
    // The invariant behind MAX_HOLDOUT_SIZE and the UI clamp: the largest
    // allowed holdout plus its equal control group is precisely all traffic.
    expect(holdoutSizeToCoverage(MAX_HOLDOUT_SIZE)).toBe(1);
  });

  it("round-trips exactly, with no floating point drift", () => {
    // Multiplying and dividing by two only shifts the exponent, so even values
    // with no exact binary representation survive the round trip.
    for (const size of [0.01, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.33, 0.5]) {
      expect(coverageToHoldoutSize(holdoutSizeToCoverage(size))).toBe(size);
    }
  });
});
