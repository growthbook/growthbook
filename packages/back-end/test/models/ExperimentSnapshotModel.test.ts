import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  getLatestSnapshot,
  createExperimentSnapshotModel,
  updateSnapshot,
  addOrUpdateSnapshotAnalysis,
  updateSnapshotAnalysis,
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import type { ExperimentSnapshotDocument } from "back-end/src/models/ExperimentSnapshotModel";
import type { Context } from "back-end/src/models/BaseModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { ExperimentSnapshotAnalysisChunkModel } from "back-end/src/models/ExperimentSnapshotAnalysisChunkModel";
import { updateExperimentAnalysisSummary } from "back-end/src/services/experiments";
import { notifyExperimentChange } from "back-end/src/services/experimentNotifications";
import { updateExperimentTimeSeries } from "back-end/src/services/experimentTimeSeries";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  updateExperimentAnalysisSummary: jest.fn(),
}));

jest.mock("back-end/src/services/experimentNotifications", () => ({
  notifyExperimentChange: jest.fn(),
}));

jest.mock("back-end/src/services/experimentTimeSeries", () => ({
  updateExperimentTimeSeries: jest.fn(),
}));

const snapshotTestContext = {
  org: { id: "org_1" },
  models: {},
} as unknown as Context;

function getSnapshotUpdateContext() {
  const context = {
    org: { id: "org_1" },
    userId: "user_1",
    userName: "Test User",
    populateForeignRefs: jest.fn().mockResolvedValue(undefined),
    models: {
      dashboards: {
        findByExperiment: jest.fn().mockResolvedValue([]),
      },
    },
  } as unknown as Context;

  context.models.experimentSnapshotAnalysisChunks =
    new ExperimentSnapshotAnalysisChunkModel(context);

  return context;
}

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysis["settings"]> = {},
): ExperimentSnapshotAnalysis["settings"] {
  return {
    dimensions: [],
    statsEngine: "bayesian",
    regressionAdjusted: false,
    sequentialTesting: false,
    differenceType: "relative",
    pValueCorrection: null,
    baselineVariationIndex: 0,
    numGoalMetrics: 1,
    ...overrides,
  };
}

function makeAnalysis({
  settings,
  value,
  status = "success",
}: {
  settings: ExperimentSnapshotAnalysis["settings"];
  value: number;
  status?: ExperimentSnapshotAnalysis["status"];
}): ExperimentSnapshotAnalysis {
  return {
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    status,
    settings,
    results: [
      {
        name: "",
        srm: 0.95,
        variations: [
          {
            users: 100,
            metrics: {
              met_1: {
                value,
                cr: value / 100,
                users: 100,
              },
            },
          },
          {
            users: 120,
            metrics: {
              met_1: {
                value: value + 5,
                cr: (value + 5) / 120,
                users: 120,
              },
            },
          },
        ],
      },
    ],
  };
}

function makeAnalysisWithoutMetrics({
  settings,
  status = "success",
}: {
  settings: ExperimentSnapshotAnalysis["settings"];
  status?: ExperimentSnapshotAnalysis["status"];
}): ExperimentSnapshotAnalysis {
  return {
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    status,
    settings,
    results: [
      {
        name: "",
        srm: 0.95,
        variations: [
          {
            users: 100,
            metrics: {},
          },
          {
            users: 120,
            metrics: {},
          },
        ],
      },
    ],
  };
}

function makeEmptyAnalysis({
  settings,
  status = "running",
}: {
  settings: ExperimentSnapshotAnalysis["settings"];
  status?: ExperimentSnapshotAnalysis["status"];
}): ExperimentSnapshotAnalysis {
  return {
    dateCreated: new Date("2025-01-02T00:00:00Z"),
    status,
    settings,
    results: [],
  };
}

function makeSnapshotWithMetric(id: string) {
  const snapshot = snapshotFactory.build({
    id,
    experiment: `exp_${id}`,
    type: "exploratory",
    status: "running",
  });
  snapshot.settings = {
    ...snapshot.settings,
    experimentId: snapshot.experiment,
    goalMetrics: ["met_1"],
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
  };
  return snapshot;
}

describe("ExperimentSnapshotModel", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    snapshotTestContext.models.experimentSnapshotAnalysisChunks =
      new ExperimentSnapshotAnalysisChunkModel(snapshotTestContext);
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe("createExperimentSnapshotModel", () => {
    it.each(["standard", "exploratory", "report"] as const)(
      "creates fresh analysis chunks when inserting a populated %s snapshot",
      async (type) => {
        const context = getSnapshotUpdateContext();
        const snapshot = makeSnapshotWithMetric(`snp_create_${type}`);
        const settings = makeAnalysisSettings();
        const analysis = makeAnalysis({ settings, value: 10 });

        snapshot.type = type;
        snapshot.status = "success";
        snapshot.analyses = [analysis];
        if (type === "report") {
          snapshot.report = "rep_1";
        }

        const created = await createExperimentSnapshotModel({
          data: snapshot,
          context,
        });

        expect(created.type).toBe(type);
        expect(created.hasChunkedAnalyses).toBe(true);
        expect(
          created.analyses[0].results[0].variations[0].metrics.met_1.value,
        ).toBe(10);

        const result = await findSnapshotById(context, snapshot.id);
        expect(result?.type).toBe(type);
        expect(result?.hasChunkedAnalyses).toBe(true);
        expect(
          result?.analyses[0].results[0].variations[0].metrics.met_1.value,
        ).toBe(10);

        const chunks =
          await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
            snapshot.id,
          );
        expect(chunks).toHaveLength(1);
        expect(chunks[0].snapshotId).toBe(snapshot.id);
        expect(chunks[0].metricId).toBe("met_1");
        expect(chunks[0].numRows).toBe(2);
      },
    );

    it("does not write chunks or metadata for analyses without results", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_no_results");
      const settings = makeAnalysisSettings();

      const result =
        await context.models.experimentSnapshotAnalysisChunks.createFromAnalyses(
          {
            snapshotId: "snp_no_results",
            experimentId: "exp_no_results",
            analyses: [makeEmptyAnalysis({ settings })],
            settings: snapshot.settings,
          },
        );

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          "snp_no_results",
        );

      expect(result).toEqual({ chunkedAnalysesMeta: [], metricIds: [] });
      expect(chunks).toHaveLength(0);
    });

    it("allows empty chunk metadata on an unchunked empty snapshot", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_empty_chunk_meta");
      const settings = makeAnalysisSettings();

      snapshot.analyses = [makeEmptyAnalysis({ settings })];
      snapshot.chunkedAnalysesMeta = [];

      const created = await createExperimentSnapshotModel({
        data: snapshot,
        context,
      });

      expect(created.hasChunkedAnalyses).toBeFalsy();
      expect(created.chunkedAnalysesMeta).toEqual([]);
    });

    it("creates fresh chunks from a populated chunked snapshot interface", async () => {
      const context = getSnapshotUpdateContext();
      const settings = makeAnalysisSettings();
      const snapshot = makeSnapshotWithMetric("snp_populated_chunked_input");
      const analysis = makeAnalysis({ settings, value: 10 });

      snapshot.status = "success";
      snapshot.analyses = [analysis];
      snapshot.hasChunkedAnalyses = true;
      snapshot.chunkedAnalysesMeta = [{ dimensions: [] }];

      const created = await createExperimentSnapshotModel({
        data: snapshot,
        context,
      });

      expect(created.hasChunkedAnalyses).toBe(true);
      expect(
        created.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(10);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(1);
      expect(chunks[0].snapshotId).toBe(snapshot.id);
    });

    it.each(["standard", "exploratory", "report"] as const)(
      "rejects pre-chunked snapshots when inserting an empty %s snapshot",
      async (type) => {
        const context = getSnapshotUpdateContext();
        const snapshot = makeSnapshotWithMetric(`snp_empty_${type}`);
        const settings = makeAnalysisSettings();

        snapshot.type = type;
        snapshot.status = "running";
        snapshot.analyses = [makeEmptyAnalysis({ settings })];
        snapshot.hasChunkedAnalyses = true;
        snapshot.chunkedAnalysesMeta = [
          {
            dimensions: [
              {
                name: "",
                srm: 0.9,
                variationUsers: [999, 999],
              },
            ],
          },
        ];
        if (type === "report") {
          snapshot.report = "rep_1";
        }

        await expect(
          createExperimentSnapshotModel({ data: snapshot, context }),
        ).rejects.toThrow("Snapshot already has chunked analyses.");
      },
    );
  });

  describe("getLatestSnapshot", () => {
    const experiment = "exp_shadow_test";
    const phase = 0;

    it("does not let errored scheduled snapshots shadow in-progress manual refreshes", async () => {
      // Multi-replica scenario: a scheduled job on a broken replica wrote
      // an errored snapshot AFTER the user kicked off a manual refresh on
      // a healthy replica. Without the fix, the UI poll (type=undefined,
      // withResults=false) would return the scheduled error instead of
      // the user's running snapshot.

      // User's manual refresh — started first, still running
      const manual = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({
        data: manual,
        context: snapshotTestContext,
      });

      // Scheduled refresh on broken replica — newer dateCreated, errored
      const scheduled = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduled,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
        // type intentionally omitted — this is what the UI poll sends
      });

      expect(result?.id).toBe(manual.id);
      expect(result?.triggeredBy).toBe("manual");
      expect(result?.status).toBe("running");
    });

    it("prefers an older running snapshot regardless of triggeredBy value", async () => {
      const runningFromSchedule = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({
        data: runningFromSchedule,
        context: snapshotTestContext,
      });

      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduledError,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(runningFromSchedule.id);
      expect(result?.triggeredBy).toBe("schedule");
      expect(result?.status).toBe("running");
    });

    it("returns the latest scheduled error when no older running snapshot exists", async () => {
      const olderSuccess = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "success",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({
        data: olderSuccess,
        context: snapshotTestContext,
      });

      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduledError,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(scheduledError.id);
      expect(result?.triggeredBy).toBe("schedule");
      expect(result?.status).toBe("error");
    });

    it("does not apply the override when beforeSnapshot is passed", async () => {
      const running = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({
        data: running,
        context: snapshotTestContext,
      });

      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduledError,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
        beforeSnapshot: {
          dateCreated: new Date("2024-01-01T12:10:00Z"),
        } as unknown as ExperimentSnapshotDocument,
      });

      expect(result?.id).toBe(scheduledError.id);
      expect(result?.status).toBe("error");
    });

    it("still surfaces successful scheduled snapshots", async () => {
      const manual = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({
        data: manual,
        context: snapshotTestContext,
      });

      // Scheduled refresh that actually worked — should win (newer + success)
      const scheduled = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "success",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduled,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(scheduled.id);
      expect(result?.triggeredBy).toBe("schedule");
      expect(result?.status).toBe("success");
    });

    it("still surfaces manual errors", async () => {
      // If the user's own refresh failed, they need to see that error.
      const manualError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: manualError,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(manualError.id);
      expect(result?.triggeredBy).toBe("manual");
      expect(result?.status).toBe("error");
    });

    it("still returns scheduled errors when type is explicitly requested", async () => {
      // If a caller explicitly asks for type="standard", they get
      // everything of that type — including scheduled errors. The
      // override only applies to the generic "latest" poll.
      const scheduled = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduled,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: false,
        type: "standard",
      });

      expect(result?.id).toBe(scheduled.id);
      expect(result?.status).toBe("error");
    });

    it("never returns scheduled errors from withResults=true (status filter already excludes them)", async () => {
      // Sanity check: withResults=true already filters to status="success".
      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduledError,
        context: snapshotTestContext,
      });

      const scheduledSuccess = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "success",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({
        data: scheduledSuccess,
        context: snapshotTestContext,
      });

      const result = await getLatestSnapshot({
        context: snapshotTestContext,
        experiment,
        phase,
        withResults: true,
      });

      expect(result?.id).toBe(scheduledSuccess.id);
      expect(result?.status).toBe("success");
    });
  });

  describe("updateSnapshot", () => {
    it("passes populated chunked analyses to post-success side effects", async () => {
      const context = getSnapshotUpdateContext();
      const experimentId = "exp_chunked_results";
      const experiment = {
        id: experimentId,
        phases: [{}],
        analysisSummary: undefined,
      };

      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      (updateExperimentAnalysisSummary as jest.Mock).mockResolvedValue(
        experiment,
      );
      (notifyExperimentChange as jest.Mock).mockResolvedValue([]);
      (updateExperimentTimeSeries as jest.Mock).mockResolvedValue(undefined);
      const populateChunkedAnalysesSpy = jest.spyOn(
        context.models.experimentSnapshotAnalysisChunks,
        "populateChunkedAnalyses",
      );

      const snapshot = snapshotFactory.build({
        id: "snp_chunked_results",
        experiment: experimentId,
        phase: 0,
        type: "standard",
        status: "running",
      });
      snapshot.settings = {
        ...snapshot.settings,
        experimentId,
        goalMetrics: ["met_1"],
        variations: [
          { id: "0", weight: 0.5 },
          { id: "1", weight: 0.5 },
        ],
      };
      await createExperimentSnapshotModel({ data: snapshot, context });

      const analysis: ExperimentSnapshotAnalysis = {
        dateCreated: new Date("2025-01-01T00:00:00Z"),
        status: "success",
        settings: {
          dimensions: [],
          statsEngine: "bayesian",
          regressionAdjusted: false,
          sequentialTesting: false,
          differenceType: "relative",
          pValueCorrection: null,
          baselineVariationIndex: 0,
          numGoalMetrics: 1,
        },
        results: [
          {
            name: "",
            srm: 0.95,
            variations: [
              {
                users: 100,
                metrics: {
                  met_1: {
                    value: 10,
                    cr: 0.1,
                    users: 100,
                  },
                },
              },
              {
                users: 120,
                metrics: {
                  met_1: {
                    value: 15,
                    cr: 0.125,
                    users: 120,
                  },
                },
              },
            ],
          },
        ],
      };

      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [analysis],
        },
      });

      expect(updateExperimentAnalysisSummary).toHaveBeenCalledTimes(1);
      const passedSnapshot = (updateExperimentAnalysisSummary as jest.Mock).mock
        .calls[0][0].experimentSnapshot as ExperimentSnapshotInterface;

      expect(passedSnapshot.hasChunkedAnalyses).toBe(true);
      expect(passedSnapshot.analyses[0].results[0].variations).toHaveLength(2);
      expect(
        passedSnapshot.analyses[0].results[0].variations[1].metrics.met_1.value,
      ).toBe(15);
      expect(populateChunkedAnalysesSpy).not.toHaveBeenCalled();
    });
  });

  describe("chunked snapshot analysis updates", () => {
    it("preserves other analyses when updating one chunked analysis", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_update_one_analysis");
      const relativeSettings = makeAnalysisSettings({
        differenceType: "relative",
      });
      const absoluteSettings = makeAnalysisSettings({
        differenceType: "absolute",
      });
      const relativeAnalysis = makeAnalysis({
        settings: relativeSettings,
        value: 10,
      });
      const absoluteAnalysis = makeAnalysis({
        settings: absoluteSettings,
        value: 20,
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [relativeAnalysis, absoluteAnalysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      const updatedRelativeAnalysis = makeAnalysis({
        settings: relativeSettings,
        value: 30,
      });

      await updateSnapshotAnalysis({
        context,
        id: snapshot.id,
        analysis: updatedRelativeAnalysis,
      });

      const result = await findSnapshotById(context, snapshot.id);
      expect(
        result?.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(30);
      expect(
        result?.analyses[1].results[0].variations[0].metrics.met_1.value,
      ).toBe(20);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe(initialChunks[0].id);
      expect(chunks[0].metricId).toBe("met_1");
    });

    it("skips chunk rewrites for a new empty running analysis", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_new_empty_analysis");
      const relativeSettings = makeAnalysisSettings({
        differenceType: "relative",
      });
      const absoluteSettings = makeAnalysisSettings({
        differenceType: "absolute",
      });
      const relativeAnalysis = makeAnalysis({
        settings: relativeSettings,
        value: 10,
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [relativeAnalysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );

      await addOrUpdateSnapshotAnalysis({
        context,
        id: snapshot.id,
        analysis: makeEmptyAnalysis({ settings: absoluteSettings }),
      });

      const result = await findSnapshotById(context, snapshot.id);
      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );

      expect(chunks.map((c) => c.id)).toEqual(initialChunks.map((c) => c.id));
      expect(result?.analyses).toHaveLength(2);
      expect(result?.analyses[0].results).toHaveLength(1);
      expect(result?.analyses[1].results).toEqual([]);
    });

    it("clears old chunked analyses when an existing analysis is reset to running", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_clear_existing_analysis");
      const relativeSettings = makeAnalysisSettings({
        differenceType: "relative",
      });
      const absoluteSettings = makeAnalysisSettings({
        differenceType: "absolute",
      });
      const relativeAnalysis = makeAnalysis({
        settings: relativeSettings,
        value: 10,
      });
      const absoluteAnalysis = makeAnalysis({
        settings: absoluteSettings,
        value: 20,
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [relativeAnalysis, absoluteAnalysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );

      await updateSnapshotAnalysis({
        context,
        id: snapshot.id,
        analysis: makeEmptyAnalysis({ settings: relativeSettings }),
      });

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.analyses[0].status).toBe("running");
      expect(result?.analyses[0].results).toEqual([]);
      expect(
        result?.analyses[1].results[0].variations[0].metrics.met_1.value,
      ).toBe(20);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe(initialChunks[0].id);
      expect(chunks[0].metricId).toBe("met_1");
    });

    it("deletes stale chunks when updateSnapshot resets analyses to empty results", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_clear_update_snapshot");
      const settings = makeAnalysisSettings();
      const analysis = makeAnalysis({
        settings,
        value: 10,
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [analysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(initialChunks).toHaveLength(1);

      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "running",
          analyses: [makeEmptyAnalysis({ settings })],
        },
      });

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.hasChunkedAnalyses).toBe(false);
      expect(result?.chunkedAnalysesMeta).toEqual([]);
      expect(result?.analyses[0].status).toBe("running");
      expect(result?.analyses[0].results).toEqual([]);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(0);
    });

    it("preserves metric-less results when updateSnapshot deletes stale chunks", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_metric_less_results");
      const settings = makeAnalysisSettings();
      const analysis = makeAnalysis({
        settings,
        value: 10,
      });
      const metricLessAnalysis = makeAnalysisWithoutMetrics({ settings });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [analysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(initialChunks).toHaveLength(1);

      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [metricLessAnalysis],
        },
      });

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(0);

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.hasChunkedAnalyses).toBe(true);
      expect(result?.chunkedAnalysesMeta).toEqual([
        {
          dimensions: [
            {
              name: "",
              srm: 0.95,
              variationUsers: [100, 120],
            },
          ],
        },
      ]);
      expect(result?.analyses[0].results).toEqual(metricLessAnalysis.results);
    });

    it("deletes chunks when the last populated analysis is reset to running", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_clear_only_analysis");
      const settings = makeAnalysisSettings();
      const analysis = makeAnalysis({
        settings,
        value: 10,
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [analysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(initialChunks).toHaveLength(1);

      await updateSnapshotAnalysis({
        context,
        id: snapshot.id,
        analysis: makeEmptyAnalysis({ settings }),
      });

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.hasChunkedAnalyses).toBe(false);
      expect(result?.chunkedAnalysesMeta).toEqual([]);
      expect(result?.analyses[0].status).toBe("running");
      expect(result?.analyses[0].results).toEqual([]);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(0);
    });

    it("clears chunk metadata when addOrUpdate resets the last populated analysis", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_clear_add_or_update");
      const settings = makeAnalysisSettings();
      const analysis = makeAnalysis({
        settings,
        value: 10,
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [analysis],
        },
      });

      const initialChunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(initialChunks).toHaveLength(1);

      await addOrUpdateSnapshotAnalysis({
        context,
        id: snapshot.id,
        analysis: makeEmptyAnalysis({ settings }),
      });

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.hasChunkedAnalyses).toBe(false);
      expect(result?.chunkedAnalysesMeta).toEqual([]);
      expect(result?.analyses[0].status).toBe("running");
      expect(result?.analyses[0].results).toEqual([]);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(0);
    });
  });
});
