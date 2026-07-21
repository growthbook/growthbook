import { isAnalysisAllowed } from "../../src/util";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";

describe("isAnalysisAllowed", () => {
  const baseSnapshotSettings = {
    dimensions: [{ id: "precomputed:country" }],
    regressionAdjustmentEnabled: false,
  } as ExperimentSnapshotSettings;

  const baseAnalysisSettings = {
    dimensions: [],
    regressionAdjusted: false,
  } as ExperimentSnapshotAnalysisSettings;

  it("allows precomputed unit dimensions from snapshot settings", () => {
    expect(
      isAnalysisAllowed(
        {
          ...baseSnapshotSettings,
          precomputedUnitDimensionIds: ["dim_country"],
        },
        {
          ...baseAnalysisSettings,
          dimensions: ["dim_country"],
        },
      ),
    ).toBe(true);
  });

  it("rejects dimensions that were not computed by the snapshot", () => {
    expect(
      isAnalysisAllowed(baseSnapshotSettings, {
        ...baseAnalysisSettings,
        dimensions: ["dim_country"],
      }),
    ).toBe(false);
  });
});
