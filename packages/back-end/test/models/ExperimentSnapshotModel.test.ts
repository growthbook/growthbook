import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { buildAnalysisKey } from "shared/snapshot-analysis-chunks";
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
    analysisKey: buildAnalysisKey(),
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
    analysisKey: buildAnalysisKey(),
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
    analysisKey: buildAnalysisKey(),
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

function makeLegacyInlineSnapshotSettings(experimentId: string) {
  return {
    manual: false,
    dimensions: [],
    metricSettings: [],
    goalMetrics: ["met_1"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 1,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId,
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    startDate: new Date(),
    endDate: new Date(),
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
  };
}

async function insertLegacyInlineSnapshot({
  id,
  experimentId,
  analyses,
}: {
  id: string;
  experimentId: string;
  analyses: Partial<ExperimentSnapshotAnalysis>[];
}) {
  await mongoose.connection.db!.collection("experimentsnapshots").insertOne({
    id,
    organization: "org_1",
    experiment: experimentId,
    phase: 0,
    dimension: null,
    dateCreated: new Date(),
    runStarted: null,
    status: "success",
    queries: [],
    unknownVariations: [],
    multipleExposures: 0,
    hasChunkedAnalyses: false,
    analyses,
    settings: makeLegacyInlineSnapshotSettings(experimentId),
  });
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
        const [perAnalysis] = Object.values(chunks[0].data);
        expect(perAnalysis?.numRows).toBe(2);
      },
    );

    it("does not write chunks or metadata for analyses without results", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_no_results");
      const settings = makeAnalysisSettings();

      const result =
        await context.models.experimentSnapshotAnalysisChunks.writeAnalyses({
          snapshotId: "snp_no_results",
          experimentId: "exp_no_results",
          analyses: [makeEmptyAnalysis({ settings })],
          settings: snapshot.settings,
          scope: "all",
        });

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          "snp_no_results",
        );

      expect(result).toEqual({ chunkedAnalysesMeta: {}, metricIds: [] });
      expect(chunks).toHaveLength(0);
    });

    it("allows empty chunk metadata on an unchunked empty snapshot", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_empty_chunk_meta");
      const settings = makeAnalysisSettings();

      snapshot.analyses = [makeEmptyAnalysis({ settings })];
      snapshot.chunkedAnalysesMeta = {};

      const created = await createExperimentSnapshotModel({
        data: snapshot,
        context,
      });

      expect(created.hasChunkedAnalyses).toBeFalsy();
      expect(created.chunkedAnalysesMeta ?? {}).toEqual({});
    });

    it("creates fresh chunks from a populated chunked snapshot interface", async () => {
      const context = getSnapshotUpdateContext();
      const settings = makeAnalysisSettings();
      const snapshot = makeSnapshotWithMetric("snp_populated_chunked_input");
      const analysis = makeAnalysis({ settings, value: 10 });

      snapshot.status = "success";
      snapshot.analyses = [analysis];
      snapshot.hasChunkedAnalyses = true;
      snapshot.chunkedAnalysesMeta = {};

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
        snapshot.chunkedAnalysesMeta = {
          an_preexisting: {
            dimensions: [
              {
                name: "",
                srm: 0.9,
                variationUsers: [999, 999],
              },
            ],
          },
        };
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
        analysisKey: buildAnalysisKey(),
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

    it("preserves distinct analysisKeys when multiple analyses share identical settings", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_shared_settings");
      const sharedSettings = makeAnalysisSettings({ statsEngine: "bayesian" });
      const firstKey = buildAnalysisKey();
      const secondKey = buildAnalysisKey();
      snapshot.analyses = [
        {
          analysisKey: firstKey,
          dateCreated: new Date("2025-01-01T00:00:00Z"),
          status: "running",
          settings: sharedSettings,
          results: [],
        },
        {
          analysisKey: secondKey,
          dateCreated: new Date("2025-01-01T00:00:00Z"),
          status: "running",
          settings: sharedSettings,
          results: [],
        },
      ];

      await createExperimentSnapshotModel({ data: snapshot, context });

      const firstAnalysis = makeAnalysis({
        settings: sharedSettings,
        value: 10,
      });
      firstAnalysis.analysisKey = firstKey;
      const secondAnalysis = makeAnalysis({
        settings: sharedSettings,
        value: 20,
      });
      secondAnalysis.analysisKey = secondKey;

      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [firstAnalysis, secondAnalysis],
        },
      });

      const stored = await findSnapshotById(context, snapshot.id);
      expect(stored?.analyses).toHaveLength(2);
      expect(stored?.analyses[0].analysisKey).toBe(firstKey);
      expect(stored?.analyses[1].analysisKey).toBe(secondKey);
      expect(
        stored?.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(10);
      expect(
        stored?.analyses[1].results[0].variations[0].metrics.met_1.value,
      ).toBe(20);
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
      expect(result?.chunkedAnalysesMeta ?? {}).toEqual({});
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
      const analysisKey = result?.analyses[0].analysisKey;
      expect(analysisKey).toBeTruthy();
      expect(result?.chunkedAnalysesMeta).toEqual({
        [analysisKey as string]: {
          dimensions: [
            {
              name: "",
              srm: 0.95,
              variationUsers: [100, 120],
            },
          ],
        },
      });
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
      expect(result?.chunkedAnalysesMeta ?? {}).toEqual({});
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
      expect(result?.chunkedAnalysesMeta ?? {}).toEqual({});
      expect(result?.analyses[0].status).toBe("running");
      expect(result?.analyses[0].results).toEqual([]);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(0);
    });
  });

  describe("concurrent analysis writes", () => {
    it("preserves the legacy inline analysis when two addOrUpdateSnapshotAnalysis calls race on different settings", async () => {
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_legacy_inline_race_different_settings";
      const experimentId = "exp_legacy_inline_race_different_settings";

      const { analysisKey: legacyKey, ...legacyAnalysis } = makeAnalysis({
        settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
        value: 11,
      });
      void legacyKey;

      await insertLegacyInlineSnapshot({
        id: legacySnapshotId,
        experimentId,
        analyses: [legacyAnalysis],
      });

      await Promise.all([
        addOrUpdateSnapshotAnalysis({
          context,
          id: legacySnapshotId,
          analysis: makeAnalysis({
            settings: makeAnalysisSettings({
              statsEngine: "frequentist",
              differenceType: "relative",
            }),
            value: 22,
          }),
        }),
        addOrUpdateSnapshotAnalysis({
          context,
          id: legacySnapshotId,
          analysis: makeAnalysis({
            settings: makeAnalysisSettings({
              statsEngine: "bayesian",
              differenceType: "absolute",
            }),
            value: 33,
          }),
        }),
      ]);

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(3);

      const values =
        result?.analyses.map(
          (a) => a.results[0]?.variations[0]?.metrics.met_1?.value ?? -1,
        ) ?? [];
      expect(values.sort((a, b) => a - b)).toEqual([11, 22, 33]);
    });

    it("persists both analyses when two writers race on different settings", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_race_different_settings");
      await createExperimentSnapshotModel({ data: snapshot, context });

      const relativeSettings = makeAnalysisSettings({
        differenceType: "relative",
      });
      const absoluteSettings = makeAnalysisSettings({
        differenceType: "absolute",
      });

      // Two analyses with distinct settings racing on the same snapshot. The
      // $ne-on-settings $push filter means both should succeed — one pushes
      // the relative slot, the other pushes the absolute slot, neither stomps.
      await Promise.all([
        addOrUpdateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings: relativeSettings, value: 10 }),
        }),
        addOrUpdateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings: absoluteSettings, value: 20 }),
        }),
      ]);

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.analyses).toHaveLength(2);

      const values = result?.analyses.map(
        (a) => a.results[0]?.variations[0]?.metrics.met_1?.value,
      );
      expect(values?.sort()).toEqual([10, 20]);

      const keys = result?.analyses.map((a) => a.analysisKey) ?? [];
      expect(new Set(keys).size).toBe(keys.length);
      expect(Object.keys(result?.chunkedAnalysesMeta ?? {}).sort()).toEqual(
        [...keys].sort(),
      );

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(1);
      const subPaths = Object.keys(chunks[0].data).sort();
      expect(subPaths).toEqual([...keys].sort());
    });

    it("deduplicates to one analysis when two writers race on the same settings", async () => {
      // Two writers with identical settings should converge — the $ne filter
      // prevents a duplicate $push; the loser falls through to update the
      // existing slot. Final snapshot has exactly one analysis and one meta
      // entry pointing at the surviving analysisKey. The loser's initial
      // chunk sub-path (written under a freshly minted key before the push
      // lost the race) may linger as an orphan — harmless because the
      // decoder only materializes sub-paths that are present in meta.
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_race_same_settings");
      await createExperimentSnapshotModel({ data: snapshot, context });

      const settings = makeAnalysisSettings();

      await Promise.all([
        addOrUpdateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings, value: 10 }),
        }),
        addOrUpdateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings, value: 20 }),
        }),
      ]);

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.analyses).toHaveLength(1);

      const survivingKey = result?.analyses[0].analysisKey as string;
      expect(Object.keys(result?.chunkedAnalysesMeta ?? {})).toEqual([
        survivingKey,
      ]);

      // Last writer wins. The surviving value is one of the two racers,
      // never a mix of the two (atomic positional $set).
      const value =
        result?.analyses[0].results[0].variations[0].metrics.met_1.value;
      expect([10, 20]).toContain(value);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(1);
      // Every sub-path that matters (i.e., has matching meta) decodes
      // correctly; orphan sub-paths with no meta entry are ignored.
      expect(chunks[0].data[survivingKey]?.numRows).toBe(2);
    });

    it("last writer wins cleanly when two writers race on updateSnapshotAnalysis for the same analysis", async () => {
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_race_same_analysis_update");
      const settings = makeAnalysisSettings();

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [makeAnalysis({ settings, value: 10 })],
        },
      });

      await Promise.all([
        updateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings, value: 30 }),
        }),
        updateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings, value: 50 }),
        }),
      ]);

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.analyses).toHaveLength(1);

      const value =
        result?.analyses[0].results[0].variations[0].metrics.met_1.value;
      // MongoDB serializes per-document updates so there is no torn row: the
      // survivor is exactly one of the racers, never a mix.
      expect([30, 50]).toContain(value);

      const chunks =
        await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
          snapshot.id,
        );
      expect(chunks).toHaveLength(1);
      const analysisKey = result?.analyses[0].analysisKey as string;
      expect(Object.keys(chunks[0].data)).toEqual([analysisKey]);
      expect(chunks[0].data[analysisKey]?.numRows).toBe(2);
    });

    it("isolates sub-paths when writers race across different analyses", async () => {
      // The load-bearing invariant: two writers on different analyses of the
      // same snapshot must touch disjoint MongoDB sub-paths. One writer's
      // rewrite of its own analysis cannot stomp the other's rows.
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_race_cross_analysis");
      const relativeSettings = makeAnalysisSettings({
        differenceType: "relative",
      });
      const absoluteSettings = makeAnalysisSettings({
        differenceType: "absolute",
      });

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [
            makeAnalysis({ settings: relativeSettings, value: 10 }),
            makeAnalysis({ settings: absoluteSettings, value: 20 }),
          ],
        },
      });

      await Promise.all([
        updateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings: relativeSettings, value: 99 }),
        }),
        updateSnapshotAnalysis({
          context,
          id: snapshot.id,
          analysis: makeAnalysis({ settings: absoluteSettings, value: 77 }),
        }),
      ]);

      const result = await findSnapshotById(context, snapshot.id);
      const byDifferenceType = new Map(
        result?.analyses.map((a) => [
          a.settings.differenceType,
          a.results[0]?.variations[0]?.metrics.met_1?.value,
        ]) ?? [],
      );
      expect(byDifferenceType.get("relative")).toBe(99);
      expect(byDifferenceType.get("absolute")).toBe(77);
    });

    it("hydrates chunked results even when hasChunkedAnalyses flag is stale-false", async () => {
      // Reproduces the P1-4 race: a single-analysis writer resetting its
      // own analysis can flip `hasChunkedAnalyses: false` based on a read
      // taken before a concurrent writer populated another analysis. The
      // scoped meta unset already preserves the surviving analysis's
      // meta entry — the read path must also not treat the stale flag
      // as authoritative, or the populated data becomes invisible.
      const context = getSnapshotUpdateContext();
      const snapshot = makeSnapshotWithMetric("snp_stale_flag");
      const settings = makeAnalysisSettings();

      await createExperimentSnapshotModel({ data: snapshot, context });
      await updateSnapshot({
        context,
        id: snapshot.id,
        updates: {
          status: "success",
          analyses: [makeAnalysis({ settings, value: 42 })],
        },
      });

      // Simulate the losing race: `hasChunkedAnalyses` flipped to false
      // on disk while the surviving analysis's meta + chunks remain.
      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.updateOne(
        { id: snapshot.id },
        { $set: { hasChunkedAnalyses: false } },
      );

      const result = await findSnapshotById(context, snapshot.id);
      expect(result?.analyses).toHaveLength(1);
      expect(
        result?.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(42);
    });
  });

  describe("legacy read-path migration", () => {
    it("decodes a legacy-shape chunk + snapshot identically to a native new-shape equivalent", async () => {
      // Insert a legacy-shape chunk doc directly into MongoDB (pre-refactor
      // shape: top-level numRows, data.a column, flat d/v/value columns).
      // `migrateSnapshot` mints a fresh analysisKey on the parent, and
      // `populateChunkedAnalyses` co-migrates the legacy chunk in memory
      // using that key — producing decoded analyses identical to a natively
      // new-shape snapshot.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_legacy_roundtrip";
      const experimentId = "exp_legacy_roundtrip";

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_legacy_1",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 2,
        data: {
          a: [0, 0],
          d: ["", ""],
          v: [0, 1],
          value: [10, 15],
          cr: [0.1, 0.125],
          users: [100, 120],
        },
      });

      // Insert a legacy-shape parent snapshot (no analysisKey; array-shaped
      // chunkedAnalysesMeta) via the raw mongoose collection. The model's
      // read path should rewrite it in memory.
      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        chunkedAnalysesMeta: [
          {
            dimensions: [{ name: "", srm: 0.95, variationUsers: [100, 120] }],
          },
        ],
        analyses: [
          {
            // no analysisKey — this is what exercises migrateSnapshot
            dateCreated: new Date(),
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
            results: [],
          },
        ],
        settings: {
          manual: false,
          dimensions: [],
          metricSettings: [],
          goalMetrics: ["met_1"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: null,
          defaultMetricPriorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 1,
          },
          regressionAdjustmentEnabled: false,
          attributionModel: "firstExposure",
          experimentId,
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          startDate: new Date(),
          endDate: new Date(),
          variations: [
            { id: "0", weight: 0.5 },
            { id: "1", weight: 0.5 },
          ],
        },
      });

      const migrated = await findSnapshotById(context, legacySnapshotId);
      expect(migrated).toBeTruthy();
      expect(migrated?.analyses).toHaveLength(1);

      const mintedKey = migrated?.analyses[0].analysisKey as string;
      expect(mintedKey).toBeTruthy();

      // Snapshot migration rewrote the array-shaped chunkedAnalysesMeta
      // into a record keyed by the same key it minted for analyses[0].
      expect(Object.keys(migrated?.chunkedAnalysesMeta ?? {})).toEqual([
        mintedKey,
      ]);

      // Decoded results should match what the legacy shape encoded.
      expect(
        migrated?.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(10);
      expect(
        migrated?.analyses[0].results[0].variations[1].metrics.met_1.value,
      ).toBe(15);
    });

    it("splits a legacy chunk with multiple analyses into per-analysis sub-records with independent numRows", async () => {
      // Legacy chunk with rows interleaved across two analyses via the `a`
      // column:
      //   Analysis 0 (one dim "", two variations) -> 2 rows.
      //   Analysis 1 (two dims "US"/"UK", but UK v0 has no metric row) -> 3 rows.
      // Total legacy numRows = 5, split asymmetrically by migration.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_legacy_multi_analysis";
      const experimentId = "exp_legacy_multi_analysis";

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_legacy_multi",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 5,
        data: {
          a: [0, 0, 1, 1, 1],
          d: ["", "", "US", "US", "UK"],
          v: [0, 1, 0, 1, 1],
          value: [10, 15, 20, 25, 30],
          cr: [0.1, 0.15, 0.2, 0.25, 0.3],
          users: [100, 120, 50, 55, 60],
        },
      });

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        chunkedAnalysesMeta: [
          {
            dimensions: [{ name: "", srm: 0.95, variationUsers: [100, 120] }],
          },
          {
            dimensions: [
              { name: "US", srm: 0.9, variationUsers: [50, 55] },
              { name: "UK", srm: 0.88, variationUsers: [45, 60] },
            ],
          },
        ],
        analyses: [
          {
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
            results: [],
          },
          {
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({
              statsEngine: "frequentist",
              dimensions: ["country"],
            }),
            results: [],
          },
        ],
        settings: {
          manual: false,
          dimensions: [],
          metricSettings: [],
          goalMetrics: ["met_1"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: null,
          defaultMetricPriorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 1,
          },
          regressionAdjustmentEnabled: false,
          attributionModel: "firstExposure",
          experimentId,
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          startDate: new Date(),
          endDate: new Date(),
          variations: [
            { id: "0", weight: 0.5 },
            { id: "1", weight: 0.5 },
          ],
        },
      });

      const migrated = await findSnapshotById(context, legacySnapshotId);
      expect(migrated).toBeTruthy();
      expect(migrated?.analyses).toHaveLength(2);

      const [analysisA, analysisB] = migrated!.analyses;
      const keyA = analysisA.analysisKey;
      const keyB = analysisB.analysisKey;
      expect(keyA).toBeTruthy();
      expect(keyB).toBeTruthy();
      expect(keyA).not.toEqual(keyB);

      // Snapshot migration rewrote the array-shaped chunkedAnalysesMeta
      // into a record keyed by the same keys minted on analyses[].
      expect(Object.keys(migrated?.chunkedAnalysesMeta ?? {}).sort()).toEqual(
        [keyA, keyB].sort(),
      );

      // Chunk migration split the 5-row legacy block 2/3 across the two
      // analyses — each analysis's decoded `results` reflects its own
      // effective numRows, not the combined total.
      expect(analysisA.settings.statsEngine).toBe("bayesian");
      expect(analysisA.results).toHaveLength(1);
      const aAll = analysisA.results[0];
      expect(aAll.name).toBe("");
      expect(aAll.variations[0].metrics.met_1.value).toBe(10);
      expect(aAll.variations[0].metrics.met_1.users).toBe(100);
      expect(aAll.variations[1].metrics.met_1.value).toBe(15);

      expect(analysisB.settings.statsEngine).toBe("frequentist");
      expect(analysisB.results).toHaveLength(2);
      const bUs = analysisB.results.find((r) => r.name === "US")!;
      const bUk = analysisB.results.find((r) => r.name === "UK")!;
      expect(bUs.variations[0].metrics.met_1.value).toBe(20);
      expect(bUs.variations[1].metrics.met_1.value).toBe(25);
      // UK v0 had no legacy row -> decoder hydrates users from meta but
      // exposes no metric entry for the missing cell.
      expect(bUk.variations[0].users).toBe(45);
      expect(bUk.variations[0].metrics.met_1).toBeUndefined();
      expect(bUk.variations[1].metrics.met_1.value).toBe(30);

      // Re-reading the legacy doc mints fresh analysisKeys (migrateSnapshot
      // allocates new random keys on each read since the migration is not
      // persisted), but the decoded numeric results must match — confirming
      // that the chunk migration correctly follows whichever keys the
      // snapshot migration mints for the same positions.
      const again = await findSnapshotById(context, legacySnapshotId);
      expect(again?.analyses).toHaveLength(2);
      expect(
        again?.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(10);
      expect(
        again?.analyses[0].results[0].variations[1].metrics.met_1.value,
      ).toBe(15);
      const againBUs = again?.analyses[1].results.find((r) => r.name === "US");
      expect(againBUs?.variations[0].metrics.met_1.value).toBe(20);
      expect(againBUs?.variations[1].metrics.met_1.value).toBe(25);
    });
  });

  describe("legacy snapshot compatibility", () => {
    it("preserves new-shape sub-records appended to a legacy chunk doc", async () => {
      // Simulates the on-disk state after a writer appends a
      // `data.<analysisKey>` sub-record (via bulkWrite) to a doc that
      // still carries legacy top-level `numRows` and flat columns. The
      // migration must rebuild the position-keyed legacy data AND keep
      // the pre-existing new-shape sub-record intact so both analyses
      // decode correctly.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_mixed_shape";
      const experimentId = "exp_mixed_shape";
      const newAnalysisKey = "an_appended_new";

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_mixed",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 2,
        data: {
          a: [0, 0],
          d: ["", ""],
          v: [0, 1],
          value: [10, 15],
          cr: [0.1, 0.125],
          users: [100, 120],
          [newAnalysisKey]: {
            numRows: 2,
            d: ["", ""],
            v: [0, 1],
            value: [42, 43],
            cr: [0.42, 0.43],
            users: [200, 200],
          },
        },
      });

      // Parent snapshot: two analyses. analyses[0] has no analysisKey
      // (legacy) — migration mints one at read time. analyses[1] already
      // has the appended key. chunkedAnalysesMeta uses the new
      // (post-refactor) record shape with meta for the appended key; the
      // legacy analysis's dimensions get hydrated in a later step of
      // decode based on the array entries seen — but for this test we
      // only assert both analyses decode their chunk data correctly.
      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        chunkedAnalysesMeta: {
          [newAnalysisKey]: {
            dimensions: [{ name: "", srm: 0.92, variationUsers: [200, 200] }],
          },
        },
        analyses: [
          {
            // legacy analysis, no analysisKey — migration will mint one
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
            results: [],
          },
          {
            analysisKey: newAnalysisKey,
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "frequentist" }),
            results: [],
          },
        ],
        settings: {
          manual: false,
          dimensions: [],
          metricSettings: [],
          goalMetrics: ["met_1"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: null,
          defaultMetricPriorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 1,
          },
          regressionAdjustmentEnabled: false,
          attributionModel: "firstExposure",
          experimentId,
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          startDate: new Date(),
          endDate: new Date(),
          variations: [
            { id: "0", weight: 0.5 },
            { id: "1", weight: 0.5 },
          ],
        },
      });

      const migrated = await findSnapshotById(context, legacySnapshotId);
      expect(migrated).toBeTruthy();
      expect(migrated?.analyses).toHaveLength(2);

      // Legacy analysis: decodes from the position-keyed data rebuilt by
      // phase-1 migration from the flat columns.
      const legacyAnalysis = migrated!.analyses[0];
      expect(legacyAnalysis.analysisKey).toBeTruthy();
      expect(legacyAnalysis.settings.statsEngine).toBe("bayesian");
      expect(legacyAnalysis.results[0].variations[0].metrics.met_1.value).toBe(
        10,
      );
      expect(legacyAnalysis.results[0].variations[1].metrics.met_1.value).toBe(
        15,
      );

      // Appended analysis: decodes from the new-shape sub-record that my
      // fix preserves through migration. Without the fix this would be
      // silently dropped and the test would see undefined results.
      const appendedAnalysis = migrated!.analyses[1];
      expect(appendedAnalysis.analysisKey).toBe(newAnalysisKey);
      expect(appendedAnalysis.settings.statsEngine).toBe("frequentist");
      expect(
        appendedAnalysis.results[0].variations[0].metrics.met_1.value,
      ).toBe(42);
      expect(
        appendedAnalysis.results[0].variations[1].metrics.met_1.value,
      ).toBe(43);
    });

    it("preserves multiple sequentially-appended new-shape sub-records", async () => {
      // Two writers each appended their own analysisKey sub-record to a
      // legacy chunk. Both must survive migration.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_mixed_sequential";
      const experimentId = "exp_mixed_sequential";
      const keyFirst = "an_first_write";
      const keySecond = "an_second_write";

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_mixed_seq",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 2,
        data: {
          a: [0, 0],
          d: ["", ""],
          v: [0, 1],
          value: [1, 2],
          cr: [0.01, 0.02],
          users: [100, 100],
          [keyFirst]: {
            numRows: 2,
            d: ["", ""],
            v: [0, 1],
            value: [10, 11],
            cr: [0.1, 0.11],
            users: [100, 100],
          },
          [keySecond]: {
            numRows: 2,
            d: ["", ""],
            v: [0, 1],
            value: [20, 21],
            cr: [0.2, 0.21],
            users: [100, 100],
          },
        },
      });

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        chunkedAnalysesMeta: {
          [keyFirst]: {
            dimensions: [{ name: "", srm: 0.9, variationUsers: [100, 100] }],
          },
          [keySecond]: {
            dimensions: [{ name: "", srm: 0.9, variationUsers: [100, 100] }],
          },
        },
        analyses: [
          {
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
            results: [],
          },
          {
            analysisKey: keyFirst,
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "frequentist" }),
            results: [],
          },
          {
            analysisKey: keySecond,
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({
              statsEngine: "frequentist",
              differenceType: "absolute",
            }),
            results: [],
          },
        ],
        settings: {
          manual: false,
          dimensions: [],
          metricSettings: [],
          goalMetrics: ["met_1"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: null,
          defaultMetricPriorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 1,
          },
          regressionAdjustmentEnabled: false,
          attributionModel: "firstExposure",
          experimentId,
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          startDate: new Date(),
          endDate: new Date(),
          variations: [
            { id: "0", weight: 0.5 },
            { id: "1", weight: 0.5 },
          ],
        },
      });

      const migrated = await findSnapshotById(context, legacySnapshotId);
      expect(migrated?.analyses).toHaveLength(3);

      // Legacy position-keyed data.
      expect(
        migrated!.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(1);
      expect(
        migrated!.analyses[0].results[0].variations[1].metrics.met_1.value,
      ).toBe(2);

      // First appended analysisKey.
      expect(
        migrated!.analyses[1].results[0].variations[0].metrics.met_1.value,
      ).toBe(10);
      expect(
        migrated!.analyses[1].results[0].variations[1].metrics.met_1.value,
      ).toBe(11);

      // Second appended analysisKey.
      expect(
        migrated!.analyses[2].results[0].variations[0].metrics.met_1.value,
      ).toBe(20);
      expect(
        migrated!.analyses[2].results[0].variations[1].metrics.met_1.value,
      ).toBe(21);
    });

    it("preserves legacy data when addOrUpdateSnapshotAnalysis appends a new analysis", async () => {
      // End-to-end regression: a legacy snapshot + chunk on disk, then the
      // production write path (`addOrUpdateSnapshotAnalysis`) appends a new
      // analysis. Without the read-path fix the re-read silently
      // drops the pre-existing legacy data; with the fix both analyses
      // decode correctly.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_write_to_legacy";
      const experimentId = "exp_write_to_legacy";

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_write_to_legacy",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 2,
        data: {
          a: [0, 0],
          d: ["", ""],
          v: [0, 1],
          value: [10, 15],
          cr: [0.1, 0.125],
          users: [100, 120],
        },
      });

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        chunkedAnalysesMeta: {
          "0": {
            dimensions: [{ name: "", srm: 0.95, variationUsers: [100, 120] }],
          },
        },
        analyses: [
          {
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
            results: [],
          },
        ],
        settings: {
          manual: false,
          dimensions: [],
          metricSettings: [],
          goalMetrics: ["met_1"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: null,
          defaultMetricPriorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 1,
          },
          regressionAdjustmentEnabled: false,
          attributionModel: "firstExposure",
          experimentId,
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          startDate: new Date(),
          endDate: new Date(),
          variations: [
            { id: "0", weight: 0.5 },
            { id: "1", weight: 0.5 },
          ],
        },
      });

      // Append a new frequentist analysis via the production write path.
      // This exercises the bulkWrite that adds `data.<newKey>` alongside
      // the legacy flat columns on the chunk doc.
      const freqSettings = makeAnalysisSettings({ statsEngine: "frequentist" });
      await addOrUpdateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: makeAnalysis({ settings: freqSettings, value: 99 }),
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(2);

      const legacyAnalysis = result!.analyses.find(
        (a) => a.settings.statsEngine === "bayesian",
      );
      const appendedAnalysis = result!.analyses.find(
        (a) => a.settings.statsEngine === "frequentist",
      );
      expect(legacyAnalysis).toBeTruthy();
      expect(appendedAnalysis).toBeTruthy();

      // Pre-existing legacy data must still be visible.
      expect(legacyAnalysis!.results[0].srm).toBe(0.95);
      expect(legacyAnalysis!.results[0].variations.map((v) => v.users)).toEqual(
        [100, 120],
      );
      expect(legacyAnalysis!.results[0].variations[0].metrics.met_1.value).toBe(
        10,
      );
      expect(legacyAnalysis!.results[0].variations[1].metrics.met_1.value).toBe(
        15,
      );

      // Appended analysis data must also be visible.
      expect(
        appendedAnalysis!.results[0].variations[0].metrics.met_1.value,
      ).toBe(99);
      expect(
        appendedAnalysis!.results[0].variations[1].metrics.met_1.value,
      ).toBe(104);

      const stored = (await snapshotsCollection.findOne({
        id: legacySnapshotId,
      })) as {
        analyses?: { analysisKey?: string }[];
        chunkedAnalysesMeta?: Record<string, unknown>;
      } | null;
      const storedKeys =
        stored?.analyses?.map((analysis) => analysis.analysisKey) ?? [];
      expect(storedKeys.every((key) => typeof key === "string" && !!key)).toBe(
        true,
      );
      expect(Object.keys(stored?.chunkedAnalysesMeta ?? {}).sort()).toEqual(
        [...storedKeys].sort(),
      );
    });

    it("preserves legacy inline analyses when updateSnapshotAnalysis writes to a snapshot from main", async () => {
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_inline_migration_update";
      const experimentId = "exp_inline_migration_update";

      const { analysisKey: bayesianKey, ...legacyBayesian } = makeAnalysis({
        settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
        value: 10,
      });
      const { analysisKey: frequentistKey, ...legacyFrequentist } =
        makeAnalysis({
          settings: makeAnalysisSettings({ statsEngine: "frequentist" }),
          value: 20,
        });
      void bayesianKey;
      void frequentistKey;

      await insertLegacyInlineSnapshot({
        id: legacySnapshotId,
        experimentId,
        analyses: [legacyBayesian, legacyFrequentist],
      });

      await updateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: {
          analysisKey: buildAnalysisKey(),
          dateCreated: new Date(),
          status: "success",
          settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
          results: [
            {
              name: "",
              srm: 0.95,
              variations: [
                {
                  users: 100,
                  metrics: { met_1: { value: 42, cr: 0.42, users: 100 } },
                },
                {
                  users: 120,
                  metrics: { met_1: { value: 47, cr: 0.392, users: 120 } },
                },
              ],
            },
          ],
        },
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(2);

      const bayesian = result!.analyses.find(
        (a) => a.settings.statsEngine === "bayesian",
      );
      const frequentist = result!.analyses.find(
        (a) => a.settings.statsEngine === "frequentist",
      );

      // Target analysis reflects the new value.
      expect(bayesian!.results[0].variations[0].metrics.met_1.value).toBe(42);
      expect(bayesian!.results[0].variations[1].metrics.met_1.value).toBe(47);

      // Non-target analysis's pre-existing inline results must still be
      // visible after the snapshot enters the mixed inline/chunked state.
      expect(frequentist!.results[0].variations[0].metrics.met_1.value).toBe(
        20,
      );
      expect(frequentist!.results[0].variations[1].metrics.met_1.value).toBe(
        25,
      );

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      const stored = (await snapshotsCollection.findOne({
        id: legacySnapshotId,
      })) as {
        hasChunkedAnalyses?: boolean;
        analyses?: { results?: unknown[] }[];
      } | null;
      expect(stored?.hasChunkedAnalyses).toBe(true);
      expect(
        stored?.analyses
          ?.map((storedAnalysis) => storedAnalysis.results?.length ?? 0)
          .sort((a, b) => a - b),
      ).toEqual([0, 1]);
    });

    it("preserves legacy inline analyses when addOrUpdateSnapshotAnalysis appends onto a snapshot from main", async () => {
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_inline_migration_append";
      const experimentId = "exp_inline_migration_append";

      const { analysisKey: bayesianKey, ...legacyBayesian } = makeAnalysis({
        settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
        value: 77,
      });
      void bayesianKey;

      await insertLegacyInlineSnapshot({
        id: legacySnapshotId,
        experimentId,
        analyses: [legacyBayesian],
      });

      await addOrUpdateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: makeAnalysis({
          settings: makeAnalysisSettings({ statsEngine: "frequentist" }),
          value: 33,
        }),
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(2);

      const bayesian = result!.analyses.find(
        (a) => a.settings.statsEngine === "bayesian",
      );
      const frequentist = result!.analyses.find(
        (a) => a.settings.statsEngine === "frequentist",
      );

      // Pre-existing inline analysis must still be visible after the write
      // path creates a mixed inline/chunked snapshot on disk.
      expect(bayesian!.results[0].variations[0].metrics.met_1.value).toBe(77);
      expect(bayesian!.results[0].variations[1].metrics.met_1.value).toBe(82);

      // Appended analysis data must also be visible.
      expect(frequentist!.results[0].variations[0].metrics.met_1.value).toBe(
        33,
      );
      expect(frequentist!.results[0].variations[1].metrics.met_1.value).toBe(
        38,
      );

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      const stored = (await snapshotsCollection.findOne({
        id: legacySnapshotId,
      })) as {
        hasChunkedAnalyses?: boolean;
        analyses?: { results?: unknown[] }[];
      } | null;
      expect(stored?.hasChunkedAnalyses).toBe(true);
      expect(
        stored?.analyses
          ?.map((storedAnalysis) => storedAnalysis.results?.length ?? 0)
          .sort((a, b) => a - b),
      ).toEqual([0, 1]);
    });

    it("preserves legacy inline baseline analyses when changing difference type on the PR branch", async () => {
      // Reproduces the bug report:
      // 1. On `main`, create a non-chunked snapshot.
      // 2. On `main`, switch baselines, which appends a second inline analysis.
      // 3. On this PR, change only the difference type while staying on that
      //    switched-baseline analysis.
      //
      // The fix should preserve the two prior inline analyses even though the
      // write path only chunks the newly-added analysis and flips the snapshot
      // into a mixed inline/chunked state on disk.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_legacy_inline_baseline_switch";
      const experimentId = "exp_legacy_inline_baseline_switch";

      const { analysisKey: baselineZeroKey, ...baselineZeroInline } =
        makeAnalysis({
          settings: makeAnalysisSettings({
            baselineVariationIndex: 0,
            differenceType: "relative",
          }),
          value: 10,
        });
      const { analysisKey: baselineOneKey, ...baselineOneInline } =
        makeAnalysis({
          settings: makeAnalysisSettings({
            baselineVariationIndex: 1,
            differenceType: "relative",
          }),
          value: 20,
        });
      void baselineZeroKey;
      void baselineOneKey;

      await insertLegacyInlineSnapshot({
        id: legacySnapshotId,
        experimentId,
        analyses: [baselineZeroInline, baselineOneInline],
      });

      await addOrUpdateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: makeAnalysis({
          settings: makeAnalysisSettings({
            baselineVariationIndex: 1,
            differenceType: "absolute",
          }),
          value: 33,
        }),
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(3);

      const baselineZeroRelative = result!.analyses.find(
        (analysis) =>
          analysis.settings.baselineVariationIndex === 0 &&
          analysis.settings.differenceType === "relative",
      );
      const baselineOneRelative = result!.analyses.find(
        (analysis) =>
          analysis.settings.baselineVariationIndex === 1 &&
          analysis.settings.differenceType === "relative",
      );
      const baselineOneAbsolute = result!.analyses.find(
        (analysis) =>
          analysis.settings.baselineVariationIndex === 1 &&
          analysis.settings.differenceType === "absolute",
      );

      expect(
        baselineZeroRelative!.results[0].variations[0].metrics.met_1.value,
      ).toBe(10);
      expect(
        baselineZeroRelative!.results[0].variations[1].metrics.met_1.value,
      ).toBe(15);
      expect(
        baselineOneRelative!.results[0].variations[0].metrics.met_1.value,
      ).toBe(20);
      expect(
        baselineOneRelative!.results[0].variations[1].metrics.met_1.value,
      ).toBe(25);
      expect(
        baselineOneAbsolute!.results[0].variations[0].metrics.met_1.value,
      ).toBe(33);
      expect(
        baselineOneAbsolute!.results[0].variations[1].metrics.met_1.value,
      ).toBe(38);
    });

    it("appends a new analysis when chunkedAnalysesMeta is stored as an array on disk", async () => {
      // Reproduces the production error:
      //   MongoServerError: Cannot create field 'an_xxx' in element
      //   {chunkedAnalysesMeta: [...]}
      // when addOrUpdateSnapshotAnalysis appends an analysis to a snapshot
      // whose chunkedAnalysesMeta was persisted in the legacy array shape.
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_array_meta_append";
      const experimentId = "exp_array_meta_append";
      const bayesianSettings = makeAnalysisSettings({
        statsEngine: "bayesian",
      });
      const frequentistSettings = makeAnalysisSettings({
        statsEngine: "frequentist",
      });

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_array_meta_append",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 4,
        data: {
          a: [0, 0, 1, 1],
          d: ["", "", "", ""],
          v: [0, 1, 0, 1],
          value: [10, 15, 20, 25],
          cr: [0.1, 0.125, 0.2, 0.208],
          users: [100, 120, 100, 120],
        },
      });

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        // Array form on disk — the bug-trigger condition.
        chunkedAnalysesMeta: [
          {
            dimensions: [{ name: "", srm: 0.95, variationUsers: [100, 120] }],
          },
          {
            dimensions: [{ name: "", srm: 0.9, variationUsers: [100, 120] }],
          },
        ],
        analyses: [
          {
            dateCreated: new Date(),
            status: "success",
            settings: bayesianSettings,
            results: [],
          },
          {
            dateCreated: new Date(),
            status: "success",
            settings: frequentistSettings,
            results: [],
          },
        ],
        settings: makeLegacyInlineSnapshotSettings(experimentId),
      });

      // The new analysis must succeed without MongoDB rejecting the
      // string-keyed sub-path write against the array meta field.
      await addOrUpdateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: makeAnalysis({
          settings: makeAnalysisSettings({
            statsEngine: "frequentist",
            differenceType: "absolute",
          }),
          value: 33,
        }),
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(3);

      const bayesian = result!.analyses.find(
        (analysis) => analysis.settings.statsEngine === "bayesian",
      );
      const frequentist = result!.analyses.find(
        (analysis) =>
          analysis.settings.statsEngine === "frequentist" &&
          analysis.settings.differenceType === "relative",
      );
      const appended = result!.analyses.find(
        (analysis) => analysis.settings.differenceType === "absolute",
      );
      expect(bayesian?.results[0].srm).toBe(0.95);
      expect(bayesian?.results[0].variations.map((v) => v.users)).toEqual([
        100, 120,
      ]);
      expect(frequentist?.results[0].srm).toBe(0.9);
      expect(frequentist?.results[0].variations.map((v) => v.users)).toEqual([
        100, 120,
      ]);
      expect(appended?.results[0].variations[0].metrics.met_1.value).toBe(33);
      expect(appended?.results[0].variations[1].metrics.met_1.value).toBe(38);

      // The previously-array meta must have been normalized to a Record
      // form on disk so subsequent partial $sets on string keys work.
      const stored = (await snapshotsCollection.findOne({
        id: legacySnapshotId,
      })) as {
        analyses?: { analysisKey?: string }[];
        chunkedAnalysesMeta?: Record<string, unknown>;
      } | null;
      expect(Array.isArray(stored?.chunkedAnalysesMeta)).toBe(false);
      expect(typeof stored?.chunkedAnalysesMeta).toBe("object");
      const storedKeys =
        stored?.analyses?.map((analysis) => analysis.analysisKey) ?? [];
      expect(storedKeys.every((key) => typeof key === "string" && !!key)).toBe(
        true,
      );
      expect(Object.keys(stored?.chunkedAnalysesMeta ?? {}).sort()).toEqual(
        [...storedKeys].sort(),
      );
    });

    it("appends a new analysis when chunkedAnalysesMeta is stored as an empty array on disk", async () => {
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_empty_array_meta_append";
      const experimentId = "exp_empty_array_meta_append";

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: false,
        chunkedAnalysesMeta: [],
        analyses: [
          {
            dateCreated: new Date(),
            status: "success",
            settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
            results: [],
          },
        ],
        settings: makeLegacyInlineSnapshotSettings(experimentId),
      });

      await addOrUpdateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: makeAnalysis({
          settings: makeAnalysisSettings({ statsEngine: "frequentist" }),
          value: 33,
        }),
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(2);
      expect(
        result?.analyses[1].results[0].variations[0].metrics.met_1.value,
      ).toBe(33);

      const stored = (await snapshotsCollection.findOne({
        id: legacySnapshotId,
      })) as { chunkedAnalysesMeta?: unknown } | null;
      expect(Array.isArray(stored?.chunkedAnalysesMeta)).toBe(false);
      expect(typeof stored?.chunkedAnalysesMeta).toBe("object");
    });

    it("updates an existing analysis when chunkedAnalysesMeta is stored as an array on disk", async () => {
      const context = getSnapshotUpdateContext();
      const legacySnapshotId = "snp_array_meta_update";
      const experimentId = "exp_array_meta_update";
      const bayesianSettings = makeAnalysisSettings({
        statsEngine: "bayesian",
      });

      const legacyChunkCollection = mongoose.connection.db!.collection(
        "experimentsnapshotanalysischunks",
      );
      await legacyChunkCollection.insertOne({
        id: "snpac_array_meta_update",
        organization: "org_1",
        snapshotId: legacySnapshotId,
        experimentId,
        metricId: "met_1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        numRows: 2,
        data: {
          a: [0, 0],
          d: ["", ""],
          v: [0, 1],
          value: [10, 15],
          cr: [0.1, 0.125],
          users: [100, 120],
        },
      });

      const snapshotsCollection = mongoose.connection.db!.collection(
        "experimentsnapshots",
      );
      await snapshotsCollection.insertOne({
        id: legacySnapshotId,
        organization: "org_1",
        experiment: experimentId,
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: null,
        status: "success",
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasChunkedAnalyses: true,
        chunkedAnalysesMeta: [
          {
            dimensions: [{ name: "", srm: 0.95, variationUsers: [100, 120] }],
          },
        ],
        analyses: [
          {
            dateCreated: new Date(),
            status: "success",
            settings: bayesianSettings,
            results: [],
          },
        ],
        settings: makeLegacyInlineSnapshotSettings(experimentId),
      });

      await updateSnapshotAnalysis({
        context,
        id: legacySnapshotId,
        analysis: makeAnalysis({
          settings: bayesianSettings,
          value: 99,
        }),
      });

      const result = await findSnapshotById(context, legacySnapshotId);
      expect(result?.analyses).toHaveLength(1);
      expect(
        result?.analyses[0].results[0].variations[0].metrics.met_1.value,
      ).toBe(99);

      const stored = (await snapshotsCollection.findOne({
        id: legacySnapshotId,
      })) as { chunkedAnalysesMeta?: unknown } | null;
      expect(Array.isArray(stored?.chunkedAnalysesMeta)).toBe(false);
      expect(typeof stored?.chunkedAnalysesMeta).toBe("object");
    });
  });
});
