import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getPrecomputedDimensions,
  getPrecomputedUnitDimensionIds,
  getSnapshotSummaryPath,
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

  it("builds snapshot-summary paths for default, dimension, and typed views", () => {
    expect(
      getSnapshotSummaryPath({
        experimentId: "exp_1",
        phase: 0,
        dimension: "",
      }),
    ).toBe("/experiment/exp_1/snapshot-summary/0");
    expect(
      getSnapshotSummaryPath({
        experimentId: "exp_1",
        phase: 0,
        dimension: "country",
      }),
    ).toBe("/experiment/exp_1/snapshot-summary/0?dimension=country");
    expect(
      getSnapshotSummaryPath({
        experimentId: "exp_1",
        phase: 0,
        dimension: "",
        snapshotType: "exploratory",
      }),
    ).toBe("/experiment/exp_1/snapshot-summary/0?type=exploratory");
  });
});
