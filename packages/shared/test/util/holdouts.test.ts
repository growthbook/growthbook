import {
  coverageToHoldoutSize,
  holdoutSizeToCoverage,
  MAX_HOLDOUT_SIZE,
} from "../../src/util/holdouts";

describe("holdout size / coverage conversion", () => {
  it("converts between holdoutSize and coverage", () => {
    expect(holdoutSizeToCoverage(0.05)).toBe(0.1);
    expect(coverageToHoldoutSize(0.1)).toBe(0.05);
    expect(holdoutSizeToCoverage(MAX_HOLDOUT_SIZE)).toBe(1);
  });

  it("round-trips", () => {
    for (const size of [0.01, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.33, 0.5]) {
      expect(coverageToHoldoutSize(holdoutSizeToCoverage(size))).toBe(size);
    }
  });
});
