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

  it("accepts one-sided CIs (Infinity in either position)", () => {
    const leftOpen = {
      ...baseMetric,
      ci: [-Infinity, 0.5],
    };
    expect(safeRolloutSnapshotMetricObject.safeParse(leftOpen).success).toBe(
      true,
    );

    const rightOpen = {
      ...baseMetric,
      ci: [-0.5, Infinity],
    };
    expect(safeRolloutSnapshotMetricObject.safeParse(rightOpen).success).toBe(
      true,
    );
  });

  it("accepts Infinity in either CI position regardless of sign", () => {
    const positiveFirst = {
      ...baseMetric,
      ci: [Infinity, -Infinity],
    };
    expect(
      safeRolloutSnapshotMetricObject.safeParse(positiveFirst).success,
    ).toBe(true);

    const negativeSecond = {
      ...baseMetric,
      ci: [0.5, -Infinity],
    };
    expect(
      safeRolloutSnapshotMetricObject.safeParse(negativeSecond).success,
    ).toBe(true);
  });

  it("rejects null in ci tuple elements", () => {
    const nullCI = {
      ...baseMetric,
      ci: [null, null],
    };
    expect(safeRolloutSnapshotMetricObject.safeParse(nullCI).success).toBe(
      false,
    );
  });
});
