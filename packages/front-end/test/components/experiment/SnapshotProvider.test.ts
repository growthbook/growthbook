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
});
