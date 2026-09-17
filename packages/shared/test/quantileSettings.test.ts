import { quantileSettingsValidator } from "../src/validators/fact-table";

describe("quantile settings", () => {
  it.each([0, -1, 1, 2, NaN, Infinity])(
    "rejects invalid percentile %s",
    (quantile) => {
      expect(
        quantileSettingsValidator.safeParse({
          quantile,
          type: "unit",
          ignoreZeros: false,
        }).success,
      ).toBe(false);
    },
  );
  it.each([0.001, 0.5, 0.999])("accepts percentile %s", (quantile) => {
    expect(
      quantileSettingsValidator.safeParse({
        quantile,
        type: "event",
        ignoreZeros: true,
      }).success,
    ).toBe(true);
  });
});
