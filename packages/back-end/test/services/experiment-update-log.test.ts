import {
  ExperimentUpdateExecutionLogger,
  logExperimentUpdated,
} from "back-end/src/services/experimentUpdateExecutionLogger";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";

describe("ExperimentUpdateExecutionLogger", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const plan = {
    runnerKind: "incremental-full" as const,
    useCache: false,
    fullRefresh: true,
    fullRefreshReason:
      "No prior Incremental Pipeline state for this experiment.",
    incrementalFallbackReason: null,
  };

  const meta = {
    datasource: { id: "ds_1", type: "bigquery" } as never,
  };

  const snapshot = (
    overrides: Parameters<typeof snapshotFactory.build>[0] = {},
  ) =>
    snapshotFactory.build({
      id: "snap_1",
      experiment: "exp_1",
      type: "standard",
      triggeredBy: "schedule",
      status: "success",
      dateCreated: new Date(-5_000),
      ...overrides,
    });

  const logLine = (
    args: Omit<Parameters<typeof logExperimentUpdated>[1], "snapshot"> & {
      snapshot?: ReturnType<typeof snapshot>;
    },
  ) => {
    const info = jest.fn();
    logExperimentUpdated({ logger: { info } } as never, {
      snapshot: args.snapshot ?? snapshot(),
      ...args,
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][1]).toBe("Experiment update completed");
    return info.mock.calls[0][0];
  };

  it("accumulates phase timings via withTiming and boundary marks", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    await logger.withTiming("generateSql", async () => {
      jest.advanceTimersByTime(10);
    });
    logger.startPhase("runQueries");
    logger.endPhase("runQueries");
    await logger.withTiming("analyze", async () => {});
    await logger.withTiming("persistSnapshot", async () => {});
    logger.startPhase("propagateSnapshot");
    logger.endPhase("propagateSnapshot");

    expect(logger.getTimings()).toEqual({
      generateSql: expect.any(Number),
      runQueries: expect.any(Number),
      analyze: expect.any(Number),
      persistSnapshot: expect.any(Number),
      propagateSnapshot: expect.any(Number),
      total: expect.any(Number),
    });
    expect(logger.getTimings().generateSql).toBe(10);
  });

  it("reports phases that never started as null", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    await logger.withTiming("analyze", async () => {
      jest.advanceTimersByTime(10);
    });
    logger.endPhase("runQueries");

    expect(logger.completedTimings()).toEqual({
      generateSql: null,
      runQueries: null,
      analyze: 10,
      persistSnapshot: null,
      propagateSnapshot: null,
      total: 10,
    });
  });

  it("records phase timings via startPhase and endPhase", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    logger.startPhase("generateSql");
    jest.advanceTimersByTime(10);
    logger.endPhase("generateSql");
    logger.startPhase("runQueries");
    logger.endPhase("runQueries");

    expect(logger.getTimings().generateSql).toBe(10);
    expect(logger.getTimings().runQueries).toBe(0);
  });

  it("starts a phase only once until ended", () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    logger.startPhase("analyze");
    const timingsAfterFirstStart = logger.getTimings().analyze;

    logger.startPhase("analyze");
    expect(logger.getTimings().analyze).toBe(timingsAfterFirstStart);

    logger.endPhase("analyze");
    expect(logger.getTimings().analyze).toBeGreaterThanOrEqual(0);
  });

  it("records analyze timing even when the wrapped fn throws", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);

    await expect(
      logger.withTiming("analyze", async () => {
        throw new Error("analysis failed");
      }),
    ).rejects.toThrow("analysis failed");

    expect(logger.getTimings().analyze).toBeGreaterThanOrEqual(0);
  });

  it("freezes total when propagateSnapshot ends", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    await logger.withTiming("generateSql", async () => {
      jest.advanceTimersByTime(10);
    });
    logger.endPhase("propagateSnapshot");

    const timingsAfterFreeze = logger.getTimings();
    expect(timingsAfterFreeze.total).toBe(10);
    jest.advanceTimersByTime(10);
    expect(logger.getTimings().total).toBe(timingsAfterFreeze.total);
  });

  it("freezes total when the line is logged without propagateSnapshot", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    await logger.withTiming("persistSnapshot", async () => {
      jest.advanceTimersByTime(10);
    });

    logLine({
      snapshotStatus: "error",
      conclusion: { concludedBy: "runner" },
      executionLogger: logger,
    });

    const totalAfterLog = logger.getTimings().total;
    expect(totalAfterLog).toBe(10);
    jest.advanceTimersByTime(10);
    expect(logger.getTimings().total).toBe(totalAfterLog);
  });

  it("emits structured fields including plan metadata and execution mode", () => {
    const logger = new ExperimentUpdateExecutionLogger(
      {
        runnerKind: "results",
        incrementalFallbackReason: "metric not compatible",
        useCache: true,
        fullRefresh: false,
        fullRefreshReason: null,
      },
      meta,
    );
    logger.execution.incrementalRefreshMode = "incremental";

    expect(
      logLine({
        snapshot: snapshot({
          type: "exploratory",
          triggeredBy: "manual",
          status: "error",
          error: "Failed to run queries",
        }),
        snapshotStatus: "error",
        conclusion: { concludedBy: "runner" },
        executionLogger: logger,
      }),
    ).toEqual({
      event: "experiment_updated",
      organization: "org_1",
      experimentId: "exp_1",
      snapshotId: "snap_1",
      snapshotType: "exploratory",
      triggeredBy: "manual",
      snapshotStatus: "error",
      concludedBy: "runner",
      reason: null,
      error: "Failed to run queries",
      datasourceId: "ds_1",
      datasourceType: "bigquery",
      runnerKind: "results",
      incrementalFallbackReason: "metric not compatible",
      plannedFullRefresh: false,
      fullRefreshReason: null,
      incrementalRefreshMode: "incremental",
      covariateSources: null,
      timingsMs: {
        generateSql: null,
        runQueries: null,
        analyze: null,
        persistSnapshot: null,
        propagateSnapshot: null,
        total: 0,
        snapshotAge: 5_000,
      },
    });
  });

  it("logs the reaper's reason with only the snapshot age when nothing timed the run", () => {
    expect(
      logLine({
        snapshot: snapshot({
          status: "error",
          runnerKind: "incremental-update",
        }),
        snapshotStatus: "error",
        conclusion: { concludedBy: "reaper", reason: "orphaned" },
        executionLogger: null,
      }),
    ).toMatchObject({
      concludedBy: "reaper",
      reason: "orphaned",
      datasourceType: null,
      runnerKind: "incremental-update",
      plannedFullRefresh: null,
      timingsMs: {
        generateSql: null,
        runQueries: null,
        analyze: null,
        persistSnapshot: null,
        propagateSnapshot: null,
        total: null,
        snapshotAge: 5_000,
      },
    });
  });

  it("accumulates per-group covariate sources and emits them", () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    logger.recordCovariateSource({
      groupId: "grp_1",
      factTableId: "ft_1",
      path: "aggregated",
      aggregatedTableFullName: "proj.ds.agg_ft_1",
      reason: "aggregated",
    });
    logger.recordCovariateSource({
      groupId: "grp_2",
      factTableId: "ft_2",
      path: "legacy",
      aggregatedTableFullName: null,
      reason: "window-not-covered",
    });

    expect(
      logLine({
        snapshotStatus: "success",
        conclusion: { concludedBy: "runner" },
        executionLogger: logger,
      }),
    ).toMatchObject({
      covariateSources: [
        {
          groupId: "grp_1",
          factTableId: "ft_1",
          path: "aggregated",
          aggregatedTableFullName: "proj.ds.agg_ft_1",
          reason: "aggregated",
        },
        {
          groupId: "grp_2",
          factTableId: "ft_2",
          path: "legacy",
          aggregatedTableFullName: null,
          reason: "window-not-covered",
        },
      ],
    });
  });
});
