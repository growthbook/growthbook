import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getPrecomputedDimensions,
  getPrecomputedUnitDimensionIds,
} from "@/components/Experiment/SnapshotProvider";

describe("SnapshotProvider helpers", () => {
  it("reads ephemeral unit dimensions from the snapshot settings", () => {
    const experiment = {
      precomputedUnitDimensionIds: ["dim_lsmi63z9mostosl7"],
    } as ExperimentInterfaceStringDates;
    const snapshot = {
      type: "standard",
      dimension: null,
      settings: {
        dimensions: [{ id: "precomputed:country" }],
        precomputedUnitDimensionIds: ["dim_lsmi63z9mostosl7"],
      },
    } as ExperimentSnapshotInterface;

    expect(getPrecomputedDimensions(snapshot, undefined)).toEqual([
      "precomputed:country",
    ]);
    expect(
      getPrecomputedUnitDimensionIds(experiment, snapshot, undefined),
    ).toEqual(["dim_lsmi63z9mostosl7"]);
  });

  it("falls back to the analysis summary for incremental unit dimensions", () => {
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
        dimensions: [],
      },
    } as unknown as ExperimentSnapshotInterface;

    expect(
      getPrecomputedUnitDimensionIds(experiment, snapshot, undefined),
    ).toEqual(["dim_lsmi63z9mostosl7"]);
  });

  it("returns no precomputed unit dimensions when neither source has them", () => {
    const experiment = {
      precomputedUnitDimensionIds: ["dim_lsmi63z9mostosl7"],
    } as ExperimentInterfaceStringDates;
    const snapshot = {
      type: "standard",
      dimension: null,
      settings: {
        dimensions: [],
      },
    } as unknown as ExperimentSnapshotInterface;

    expect(
      getPrecomputedUnitDimensionIds(experiment, snapshot, undefined),
    ).toEqual([]);
  });
});
