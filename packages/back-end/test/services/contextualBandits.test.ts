import { getQuantileBucketEdges } from "back-end/src/services/contextualBandits";

describe("contextual bandit quantile bucket helpers", () => {
  it("computes interpolated bucket edges", () => {
    expect(getQuantileBucketEdges([0, 10, 20, 30, 40], 4)).toEqual([
      0, 10, 20, 30, 40,
    ]);
    expect(getQuantileBucketEdges([0, 100], 4)).toEqual([0, 25, 50, 75, 100]);
  });

  it("sorts values and ignores non-finite values", () => {
    expect(
      getQuantileBucketEdges(
        [30, Number.NaN, 10, Number.POSITIVE_INFINITY, 20],
        2,
      ),
    ).toEqual([10, 20, 30]);
  });

  it("returns repeated edges for a single finite value", () => {
    expect(getQuantileBucketEdges([5], 3)).toEqual([5, 5, 5, 5]);
  });
});
