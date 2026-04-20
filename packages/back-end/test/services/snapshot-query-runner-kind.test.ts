import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { getSnapshotQueryRunnerKind } from "back-end/src/services/experiments";

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

describe("getSnapshotQueryRunnerKind", () => {
  it("returns 'incremental' for a standard snapshot when all conditions are met", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental");
  });

  it("returns 'incremental-exploratory' for an exploratory snapshot when all conditions are met", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "exploratory",
        hasSnapshotDimensions: true,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental-exploratory");
  });

  it("returns 'incremental' for exploratory snapshots without dimensions when the units table has been materialized", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "exploratory",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental");
  });

  it("returns 'results' for exploratory snapshots without dimensions when the units table has not been materialized", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "exploratory",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: false,
      }),
    ).toBe("results");
  });

  it("returns 'incremental' for standard snapshots even when the units table has not been materialized (full refresh will create it)", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: false,
      }),
    ).toBe("incremental");
  });

  it("returns 'results' when allowIncrementalRefresh is false", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: false,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("returns 'results' when experiment is not compatible with incremental refresh", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: false,
        datasource: makeDatasource(),
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("returns 'results' when datasource pipeline mode is not incremental", () => {
    const datasource = makeDatasource({ mode: "parallel" as never });
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("returns 'results' when experiment is excluded from incremental refresh", () => {
    const datasource = makeDatasource({
      excludedExperimentIds: ["exp_123"],
    });
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("returns 'results' when includedExperimentIds is set but does not include the experiment", () => {
    const datasource = makeDatasource({
      includedExperimentIds: ["exp_other"],
    });
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("returns 'incremental' when includedExperimentIds includes the experiment", () => {
    const datasource = makeDatasource({
      includedExperimentIds: ["exp_123"],
    });
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource,
        experiment: makeExperiment(),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental");
  });

  it("returns 'results' for multi-armed-bandit experiments", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment({ type: "multi-armed-bandit" }),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("returns 'incremental' when experiment.type is undefined (legacy)", () => {
    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: makeDatasource(),
        experiment: makeExperiment({ type: undefined }),
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental");
  });
});
