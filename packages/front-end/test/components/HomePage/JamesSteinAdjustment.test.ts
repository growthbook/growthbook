import { getStandardErrorFromLargestSample } from "@/components/HomePage/ExperimentImpact/JamesSteinAdjustment";

describe("getStandardErrorFromLargestSample", () => {
  it("keeps the standard error from the largest sample regardless of order", () => {
    expect(
      getStandardErrorFromLargestSample([
        { totalUnits: 1_000, standardError: 10 },
        { totalUnits: 100, standardError: 20 },
      ]),
    ).toBe(10);
  });

  it("skips samples with a zero standard error", () => {
    expect(
      getStandardErrorFromLargestSample([
        { totalUnits: 100, standardError: 10 },
        { totalUnits: 1_000, standardError: 0 },
      ]),
    ).toBe(10);
  });
});
