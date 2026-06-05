import { ExperimentUpdateExecutionLogger } from "back-end/src/services/experimentUpdateExecutionLogger";

describe("ExperimentUpdateExecutionLogger", () => {
  const plan = {
    runnerKind: "incremental" as const,
    useCache: false,
    fullRefresh: true,
    fullRefreshReason:
      "No prior incremental refresh state for this experiment.",
    incrementalFallbackReason: null,
  };

  const meta = {
    experimentId: "exp_1",
    snapshotId: "snap_1",
    snapshotType: "standard" as const,
    triggeredBy: "schedule" as const,
    datasource: { id: "ds_1", type: "bigquery" } as const,
  };

  it("accumulates phase timings via withTiming and boundary marks", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    await logger.withTiming("generateSql", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
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
    expect(logger.getTimings().generateSql).toBeGreaterThanOrEqual(10);
  });

  it("records phase timings via startPhase and endPhase", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    logger.startPhase("generateSql");
    await new Promise((resolve) => setTimeout(resolve, 10));
    logger.endPhase("generateSql");
    logger.startPhase("runQueries");
    logger.endPhase("runQueries");

    expect(logger.getTimings().generateSql).toBeGreaterThanOrEqual(10);
    expect(logger.getTimings().runQueries).toBeGreaterThanOrEqual(0);
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    logger.endPhase("propagateSnapshot");

    const timingsAfterFreeze = logger.getTimings();
    expect(timingsAfterFreeze.total).toBeGreaterThanOrEqual(10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.getTimings().total).toBe(timingsAfterFreeze.total);
  });

  it("freezes total when logUpdateCompleted runs without propagateSnapshot", async () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    await logger.withTiming("persistSnapshot", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const info = jest.fn();
    logger.logUpdateCompleted({ logger: { info } } as never, {
      snapshotStatus: "error",
      error: "query failed",
    });

    expect(logger.getTimings().total).toBeGreaterThanOrEqual(10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.getTimings().total).toBeGreaterThanOrEqual(10);
  });

  it("logs only once on terminal snapshot status", () => {
    const logger = new ExperimentUpdateExecutionLogger(plan, meta);
    const info = jest.fn();
    const context = { logger: { info } } as const;

    logger.logUpdateCompleted(context, { snapshotStatus: "running" });
    logger.logUpdateCompleted(context, { snapshotStatus: "success" });
    logger.logUpdateCompleted(context, { snapshotStatus: "success" });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatchObject({
      event: "experiment_updated",
      snapshotStatus: "success",
      timingsMs: expect.objectContaining({
        generateSql: 0,
        analyze: 0,
      }),
    });
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
      {
        ...meta,
        snapshotType: "exploratory",
        triggeredBy: "manual",
      },
    );
    logger.execution.incrementalRefreshMode = "incremental";
    const info = jest.fn();

    logger.logUpdateCompleted({ logger: { info } } as never, {
      snapshotStatus: "error",
      error: "Failed to run queries",
    });

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "experiment_updated",
        experimentId: "exp_1",
        snapshotId: "snap_1",
        snapshotType: "exploratory",
        triggeredBy: "manual",
        snapshotStatus: "error",
        error: "Failed to run queries",
        runnerKind: "results",
        incrementalFallbackReason: "metric not compatible",
        plannedFullRefresh: false,
        fullRefreshReason: null,
        incrementalRefreshMode: "incremental",
        timingsMs: expect.any(Object),
      }),
      "Experiment update completed",
    );
  });
});
