import { interleavingResultToSnapshotMetrics } from "@/services/interleaving";

describe("interleavingResultToSnapshotMetrics", () => {
  it("puts the test on treatment and widens null CI bounds", () => {
    const [control, treatment] = interleavingResultToSnapshotMetrics({
      metricId: "fact__m",
      analysis: { type: "paired" },
      users: 100,
      denominator: 250,
      control: { value: 10, cr: 0.04 },
      treatment: { value: 15, cr: 0.06 },
      test: {
        expected: 0.05,
        ci: [0.01, null],
        uplift: { dist: "normal", mean: 0.05, stddev: 0.02 },
        pValue: null,
        errorMessage: null,
        pValueErrorMessage: "too few users",
      },
    });
    expect(control).toEqual({
      value: 10,
      cr: 0.04,
      users: 100,
      denominator: 250,
    });
    expect(treatment.denominator).toBe(250);
    expect(treatment.ci).toEqual([0.01, Infinity]);
    expect(treatment.expected).toBe(0.05);
    expect(treatment.pValue).toBeUndefined();
    expect(treatment.errorMessage).toBeUndefined();
  });
});
