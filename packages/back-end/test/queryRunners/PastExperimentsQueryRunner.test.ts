import { PastExperimentResult } from "shared/types/integrations";
import { PastExperiment } from "shared/types/past-experiments";
import {
  getPastExperimentsWatermark,
  mergePastExperimentResults,
  withCountedIdentifierTypes,
} from "back-end/src/queryRunners/PastExperimentsQueryRunner";

function row(
  overrides: Partial<PastExperiment> &
    Pick<PastExperiment, "trackingKey" | "exposureQueryId">,
): PastExperiment {
  return {
    experimentName: overrides.trackingKey,
    variationKeys: ["0", "1"],
    variationNames: ["Control", "Treatment"],
    numVariations: 2,
    weights: [0.5, 0.5],
    users: 100,
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-10"),
    latestData: new Date("2024-01-10"),
    ...overrides,
  };
}

function result(
  exposureQueryId: string,
  trackingKey: string,
  mergeResults: boolean,
): PastExperimentResult {
  return {
    exposureQueryId,
    identifierTypes: ["anonymous_id"],
    mergeResults,
    experiments: [
      {
        exposureQueryId,
        identifierType: "anonymous_id",
        experiment_id: trackingKey,
        experiment_name: trackingKey,
        variation_id: "1",
        variation_name: "Treatment",
        users: 100,
        start_date: new Date("2024-01-11"),
        end_date: new Date("2024-01-20"),
        latest_data: new Date("2024-01-20"),
        start_of_range: false,
      },
    ],
  };
}

const runStarted = new Date("2024-01-21");

function queries(...ids: string[]) {
  return ids.map((id) => ({
    id,
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id"],
  }));
}

describe("mergePastExperimentResults", () => {
  it("merges normalized stored weights using user counts", () => {
    const { experiments } = mergePastExperimentResults({
      previous: {
        experiments: [
          row({
            trackingKey: "exp_1",
            exposureQueryId: "eq_1",
            weights: [0.9, 0.1],
          }),
        ],
      },
      results: [result("eq_1", "exp_1", true)],
      exposureQueries: queries("eq_1"),
      runStarted,
    });

    expect(experiments).toHaveLength(1);
    expect(experiments[0].users).toBe(200);
    // Existing [0.9, 0.1] over 100 users => [90, 10], then +100 on variation 1
    // gives [90, 110] => [0.45, 0.55] after rounding/normalization.
    expect(experiments[0].weights).toEqual([0.45, 0.55]);
  });

  it("merges into rows from before identifiers were recorded", () => {
    const { experiments, exposureQueryRuns } = mergePastExperimentResults({
      // Counted on the query's legacy identifier, but not labeled
      previous: {
        experiments: [row({ trackingKey: "exp_1", exposureQueryId: "eq_1" })],
      },
      results: [result("eq_1", "exp_1", true)],
      exposureQueries: queries("eq_1"),
      runStarted,
    });

    expect(
      experiments.map((e) => [e.trackingKey, e.identifierType, e.users]),
    ).toEqual([["exp_1", "anonymous_id", 200]]);
    expect(exposureQueryRuns).toEqual([
      {
        exposureQueryId: "eq_1",
        identifierTypes: ["anonymous_id"],
        lastRunAt: runStarted,
      },
    ]);
  });

  it("keeps each identifier's counts in its own row", () => {
    const counted = result("eq_1", "exp_1", false);
    counted.experiments = [
      { ...counted.experiments[0], identifierType: "anonymous_id", users: 300 },
      { ...counted.experiments[0], identifierType: "user_id", users: 120 },
    ];

    const { experiments } = mergePastExperimentResults({
      previous: {},
      results: [counted],
      exposureQueries: queries("eq_1"),
      runStarted,
    });

    expect(
      experiments.map((e) => [e.trackingKey, e.identifierType, e.users]),
    ).toEqual([
      ["exp_1", "anonymous_id", 300],
      ["exp_1", "user_id", 120],
    ]);
  });

  it("only changes the assignment queries that ran", () => {
    const skippedRun = {
      exposureQueryId: "eq_skipped",
      identifierTypes: ["user_id"],
      lastRunAt: new Date("2024-01-05"),
    };
    const { experiments, exposureQueryRuns } = mergePastExperimentResults({
      previous: {
        experiments: [
          row({ trackingKey: "old", exposureQueryId: "eq_ran" }),
          row({ trackingKey: "kept", exposureQueryId: "eq_skipped" }),
          row({ trackingKey: "gone", exposureQueryId: "eq_deleted" }),
        ],
        exposureQueryRuns: [
          skippedRun,
          {
            exposureQueryId: "eq_deleted",
            identifierTypes: ["user_id"],
            lastRunAt: new Date("2024-01-05"),
          },
        ],
      },
      // A full rerun replaces the query's rows instead of merging into them.
      results: [result("eq_ran", "new", false)],
      exposureQueries: queries("eq_ran", "eq_skipped"),
      runStarted,
    });

    expect(experiments.map((e) => e.trackingKey).sort()).toEqual([
      "kept",
      "new",
    ]);
    expect(exposureQueryRuns).toEqual([
      skippedRun,
      {
        exposureQueryId: "eq_ran",
        identifierTypes: ["anonymous_id"],
        lastRunAt: runStarted,
      },
    ]);
  });

  it("replaces every query a result from before per-query discovery covers", () => {
    const legacy = result("eq_1", "new", false);
    delete legacy.exposureQueryId;
    delete legacy.identifierTypes;

    const { experiments, exposureQueryRuns } = mergePastExperimentResults({
      previous: {
        experiments: [row({ trackingKey: "old", exposureQueryId: "eq_1" })],
      },
      results: [legacy],
      exposureQueries: queries("eq_1"),
      runStarted,
    });

    expect(experiments.map((e) => e.trackingKey)).toEqual(["new"]);
    // No identifiers recorded, so the next run is a full one.
    expect(exposureQueryRuns).toEqual([]);
  });
});

describe("getPastExperimentsWatermark", () => {
  const model = {
    experiments: [
      row({
        trackingKey: "a",
        exposureQueryId: "eq_1",
        latestData: new Date("2024-01-10"),
      }),
      row({
        trackingKey: "b",
        exposureQueryId: "eq_1",
        latestData: new Date("2024-01-15"),
      }),
      row({
        trackingKey: "c",
        exposureQueryId: "eq_2",
        latestData: new Date("2024-02-01"),
      }),
    ],
    exposureQueryRuns: [
      {
        exposureQueryId: "eq_1",
        identifierTypes: ["anonymous_id", "user_id"],
        lastRunAt: new Date("2024-01-16"),
      },
      {
        exposureQueryId: "eq_3",
        identifierTypes: ["user_id"],
        lastRunAt: new Date("2024-01-16"),
      },
    ],
  };

  it("continues from the latest data among the query's own rows", () => {
    expect(
      getPastExperimentsWatermark(model, "eq_1", ["user_id", "anonymous_id"]),
    ).toEqual(new Date("2024-01-15"));
  });

  it("reruns fully when the query's identifiers changed", () => {
    expect(getPastExperimentsWatermark(model, "eq_1", ["user_id"])).toBeNull();
  });

  it("reruns fully when the query found nothing", () => {
    expect(getPastExperimentsWatermark(model, "eq_3", ["user_id"])).toBeNull();
  });

  it("continues rows from before identifiers were recorded when they cover every identifier", () => {
    const legacy = {
      experiments: [
        row({
          trackingKey: "a",
          exposureQueryId: "eq_1",
          identifierType: "user_id",
          latestData: new Date("2024-01-15"),
        }),
      ],
    };
    expect(getPastExperimentsWatermark(legacy, "eq_1", ["user_id"])).toEqual(
      new Date("2024-01-15"),
    );
    // The legacy rows never counted anonymous_id
    expect(
      getPastExperimentsWatermark(legacy, "eq_1", ["user_id", "anonymous_id"]),
    ).toBeNull();
    // Unlabeled: the legacy identifier is gone, so what was counted is unknown
    expect(
      getPastExperimentsWatermark(
        { experiments: [row({ trackingKey: "a", exposureQueryId: "eq_1" })] },
        "eq_1",
        ["user_id"],
      ),
    ).toBeNull();
  });
});

describe("withCountedIdentifierTypes", () => {
  it("labels cached rows with the legacy identifier only while it's declared", () => {
    const labeled = withCountedIdentifierTypes(
      [
        row({ trackingKey: "kept", exposureQueryId: "eq_kept" }),
        row({ trackingKey: "dropped", exposureQueryId: "eq_dropped" }),
        row({
          trackingKey: "counted",
          exposureQueryId: "eq_dropped",
          identifierType: "user_id",
        }),
      ],
      [
        {
          id: "eq_kept",
          userIdType: "anonymous_id",
          userIdTypes: ["user_id", "anonymous_id"],
        },
        {
          id: "eq_dropped",
          userIdType: "anonymous_id",
          userIdTypes: ["user_id"],
        },
      ],
    );

    expect(labeled.map((e) => [e.trackingKey, e.identifierType])).toEqual([
      ["kept", "anonymous_id"],
      // Counted on anonymous_id, which the query no longer declares
      ["dropped", undefined],
      ["counted", "user_id"],
    ]);
  });
});
