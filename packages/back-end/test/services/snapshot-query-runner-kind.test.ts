import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { resolveSnapshotRunner } from "back-end/src/services/experiments";

function makeDatasource(
  pipelineOverrides: Partial<
    NonNullable<DataSourceInterface["settings"]["pipelineSettings"]>
  > = {},
): DataSourceInterface {
  return {
    id: "ds_123",
    type: "postgres",
    settings: {
      queries: {},
      pipelineSettings: {
        allowWriting: true,
        mode: "incremental",
        ...pipelineOverrides,
      },
    },
  } as unknown as DataSourceInterface;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_123",
    organization: "org_123",
    type: "standard",
    ...overrides,
  } as unknown as ExperimentInterface;
}

describe("resolveSnapshotRunner", () => {
  it("returns 'incremental' for a standard snapshot when all conditions are met", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("incremental");
  });

  it("returns 'incremental-exploratory' for an exploratory snapshot when all conditions are met", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "exploratory",
        hasSnapshotDimensions: true,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("incremental-exploratory");
  });

  it("returns 'incremental' for exploratory snapshots without dimensions when the units table has been materialized", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "exploratory",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("incremental");
  });

  it("returns 'results' for exploratory snapshots without dimensions when the units table has not been materialized", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "exploratory",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: false,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason:
        "No materialized units table yet for this dimension-less exploratory snapshot.",
    });
  });

  it("returns 'incremental' for standard snapshots even when the units table has not been materialized (full refresh will create it)", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: false,
      }).runnerKind,
    ).toBe("incremental");
  });

  it("returns 'results' with no fallback reason when datasource pipeline mode is not incremental", () => {
    const datasource = makeDatasource({ mode: "parallel" as never });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason: null,
    });
  });

  it("returns 'results' with no fallback reason when experiment is excluded from incremental refresh", () => {
    const datasource = makeDatasource({
      excludedExperimentIds: ["exp_123"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason: null,
    });
  });

  it("returns 'results' with no fallback reason when includedExperimentIds is set but does not include the experiment", () => {
    const datasource = makeDatasource({
      includedExperimentIds: ["exp_other"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason: null,
    });
  });

  it("returns 'incremental' when includedExperimentIds includes the experiment", () => {
    const datasource = makeDatasource({
      includedExperimentIds: ["exp_123"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("incremental");
  });

  it("returns 'results' for multi-armed-bandit experiments", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment({ type: "multi-armed-bandit" }),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason:
        'Experiment type "multi-armed-bandit" is not supported for incremental refresh.',
    });
  });

  it("returns 'incremental' when experiment.type is undefined (legacy)", () => {
    expect(
      resolveSnapshotRunner({
        datasource: makeDatasource(),
        experiment: makeExperiment({ type: undefined }),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("incremental");
  });

  it("returns 'incremental' for an opted-in experiment when default mode is ephemeral", () => {
    const datasource = makeDatasource({
      mode: "ephemeral",
      incrementalOptInExperimentIds: ["exp_123"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("incremental");
  });

  it("returns 'results' with no fallback reason for an experiment that is not in the opt-in list when default mode is ephemeral", () => {
    const datasource = makeDatasource({
      mode: "ephemeral",
      incrementalOptInExperimentIds: ["exp_other"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason: null,
    });
  });

  it("ignores opt-in when mode is 'incremental' so excludedExperimentIds wins", () => {
    const datasource = makeDatasource({
      mode: "incremental",
      excludedExperimentIds: ["exp_123"],
      incrementalOptInExperimentIds: ["exp_123"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }).runnerKind,
    ).toBe("results");
  });

  it("returns 'results' with no fallback reason when allowWriting is false even with opt-in", () => {
    const datasource = makeDatasource({
      allowWriting: false,
      mode: "ephemeral",
      incrementalOptInExperimentIds: ["exp_123"],
    });
    expect(
      resolveSnapshotRunner({
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toEqual({
      runnerKind: "results",
      incrementalFallbackReason: null,
    });
  });
});
