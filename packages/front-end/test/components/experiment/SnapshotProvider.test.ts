import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getPrecomputedDimensions,
  getPrecomputedUnitDimensionIds,
} from "@/components/Experiment/SnapshotProvider";

describe("SnapshotProvider helpers", () => {
  it("keeps precomputed unit dimension ids separate from experiment dimensions", () => {
    const experiment = {
      precomputedUnitDimensionIds: ["dim_lsmi63z9mostosl7"],
      analysisSummary: {
        precomputedUnitDimensions: ["dim_lsmi63z9mostosl7"],
      },
    } as ExperimentInterfaceStringDates;
    const snapshot = {
      type: "standard",
      dimension: null,
      settings: {
        dimensions: [{ id: "precomputed:country" }],
      },
    } as ExperimentSnapshotInterface;

    expect(getPrecomputedDimensions(snapshot, undefined)).toEqual([
      "precomputed:country",
    ]);
    expect(getPrecomputedUnitDimensionIds(experiment)).toEqual([
      "dim_lsmi63z9mostosl7",
    ]);
  });

  it("returns no precomputed unit dimensions before the exploratory batch populates them", () => {
    const experiment = {
      precomputedUnitDimensionIds: ["dim_lsmi63z9mostosl7"],
    } as ExperimentInterfaceStringDates;

    expect(getPrecomputedUnitDimensionIds(experiment)).toEqual([]);
  });
});
