import { safeRolloutSnapshotMetricObject } from "shared/validators";

describe("safe-rollout-snapshot validators", () => {
  const baseMetric = {
    value: 100,
    cr: 0.5,
    users: 1000,
  };

  it("accepts Infinity and -Infinity values in ci fields", () => {
    const metricWithInfinity = {
      ...baseMetric,
      ci: [-Infinity, Infinity],
      ciAdjusted: [-Infinity, Infinity],
    };

    const result =
      safeRolloutSnapshotMetricObject.safeParse(metricWithInfinity);
    expect(result.success).toBe(true);
  });

  it("accepts valid number values in ci fields", () => {
    const metricWithNumbers = {
      ...baseMetric,
      ci: [-0.5, 0.5],
      ciAdjusted: [-0.3, 0.7],
    };

    const result = safeRolloutSnapshotMetricObject.safeParse(metricWithNumbers);
    expect(result.success).toBe(true);
  });
});
