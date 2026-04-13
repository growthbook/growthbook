import mongoose, { FilterQuery, PipelineStage } from "mongoose";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import {
  snapshotSatisfiesBlock,
  blockHasFieldOfType,
  DashboardInterface,
} from "shared/enterprise";
import {
  isString,
  estimateJsonBytes,
  SNAPSHOT_ANALYSES_OVERFLOW_THRESHOLD_BYTES,
} from "shared/util";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { logger } from "back-end/src/util/logger";
import { migrateSnapshot } from "back-end/src/util/migrations";
import { notifyExperimentChange } from "back-end/src/services/experimentNotifications";
import { updateExperimentAnalysisSummary } from "back-end/src/services/experiments";
import { updateExperimentTimeSeries } from "back-end/src/services/experimentTimeSeries";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { queriesSchema } from "./QueryModel";
import { Context } from "./BaseModel";
import { getExperimentById } from "./ExperimentModel";

const experimentSnapshotTrafficObject = {
  _id: false,
  name: String,
  srm: Number,
  variationUnits: [Number],
};

const banditResultObject = {
  _id: false,
  singleVariationResults: [
    {
      _id: false,
      users: Number,
      cr: Number,
      ci: [Number],
    },
  ],
  currentWeights: [Number],
  updatedWeights: [Number],
  srm: Number,
  bestArmProbabilities: [Number],
  additionalReward: Number,
  seed: Number,
  updateMessage: String,
  error: String,
  reweight: Boolean,
  weightsWereUpdated: Boolean,
};

const experimentSnapshotSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  experiment: String,
  phase: Number,
  type: { type: String },
  triggeredBy: String,
  report: String,
  dateCreated: Date,
  runStarted: Date,
  manual: Boolean,
  query: String,
  queryLanguage: String,
  error: String,
  queries: queriesSchema,
  dimension: String,
  unknownVariations: [String],
  multipleExposures: Number,
  hasCorrectedStats: Boolean,
  status: String,
  settings: {},
  analyses: {},
  hasOverflowAnalyses: Boolean,
  results: [
    {
      _id: false,
      name: String,
      srm: Number,
      variations: [
        {
          _id: false,
          users: Number,
          metrics: {
            type: Map,
            of: {
              _id: false,
              value: Number,
              cr: Number,
              users: Number,
              denominator: Number,
              ci: [Number],
              uplift: {
                dist: String,
                mean: Number,
                stddev: Number,
              },
              stats: {
                users: Number,
                mean: Number,
                count: Number,
                stddev: Number,
              },
              expected: Number,
              risk: [Number],
              buckets: [
                {
                  _id: false,
                  x: Number,
                  y: Number,
                },
              ],
              chanceToWin: Number,
              pValue: Number,
              supplementalResults: {},
            },
          },
        },
      ],
    },
  ],
  banditResult: banditResultObject,
  health: {
    _id: false,
    traffic: {
      _id: false,
      overall: experimentSnapshotTrafficObject,
      dimension: {
        type: Map,
        of: [experimentSnapshotTrafficObject],
      },
      error: String,
    },
    power: {
      _id: false,
      type: { type: String },
      power: Number,
      isLowPowered: Boolean,
      additionalDaysNeeded: Number,
      metricVariationPowerResults: [
        {
          _id: false,
          metricId: String,
          variation: Number,
          errorMessage: String,
          power: Number,
          isLowPowered: Boolean,
          effectSize: Number,
          additionalDaysNeeded: Number,
        },
      ],
    },
  },
  hasRawQueries: Boolean,
  queryFilter: String,
  segment: String,
  activationMetric: String,
  skipPartialData: Boolean,
  statsEngine: String,
  regressionAdjustmentEnabled: Boolean,
  metricRegressionAdjustmentStatuses: [
    {
      _id: false,
      metric: String,
      regressionAdjustmentEnabled: Boolean,
      regressionAdjustmentDays: Number,
      reason: String,
    },
  ],
  sequentialTestingEnabled: Boolean,
  sequentialTestingTuningParameter: Number,
});
experimentSnapshotSchema.index({
  experiment: 1,
  dateCreated: -1,
});

export type ExperimentSnapshotDocument = mongoose.Document &
  LegacyExperimentSnapshotInterface;

const ExperimentSnapshotModel =
  mongoose.model<LegacyExperimentSnapshotInterface>(
    "ExperimentSnapshot",
    experimentSnapshotSchema,
  );

const toInterface = (
  doc: ExperimentSnapshotDocument,
): ExperimentSnapshotInterface =>
  migrateSnapshot(
    omit(doc.toJSON<ExperimentSnapshotDocument>(), ["__v", "_id"]),
  );

async function hydrateOverflowAnalyses(
  context: Context,
  snapshot: ExperimentSnapshotInterface,
): Promise<ExperimentSnapshotInterface> {
  if (snapshot.hasOverflowAnalyses) {
    snapshot.analyses =
      await context.models.snapshotAnalysisOverflow.getAnalysesForSnapshot(
        snapshot.id,
      );
  }
  return snapshot;
}

async function hydrateOverflowAnalysesBatch(
  context: Context,
  snapshots: ExperimentSnapshotInterface[],
): Promise<ExperimentSnapshotInterface[]> {
  const overflowIds = snapshots
    .filter((s) => s.hasOverflowAnalyses)
    .map((s) => s.id);
  if (!overflowIds.length) return snapshots;

  const analysesMap =
    await context.models.snapshotAnalysisOverflow.getAnalysesForSnapshots(
      overflowIds,
    );
  for (const snapshot of snapshots) {
    if (snapshot.hasOverflowAnalyses) {
      snapshot.analyses = analysesMap.get(snapshot.id) ?? [];
    }
  }
  return snapshots;
}

// Persists `analyses` for a snapshot, spilling to the overflow collection only
// when the serialized size would risk exceeding the 16MB BSON limit. Used by
// updateSnapshot and the single-analysis add/update helpers.
async function writeAnalysesWithOverflow(
  context: Context,
  organization: string,
  id: string,
  analyses: ExperimentSnapshotAnalysis[],
): Promise<void> {
  const overflow =
    estimateJsonBytes(analyses) > SNAPSHOT_ANALYSES_OVERFLOW_THRESHOLD_BYTES;

  if (overflow) {
    // Write chunks before flipping the flag so a partial failure doesn't
    // leave the snapshot pointing at missing overflow data.
    await context.models.snapshotAnalysisOverflow.replaceForSnapshot(
      id,
      analyses,
    );
    await ExperimentSnapshotModel.updateOne(
      { organization, id },
      { $set: { analyses: [], hasOverflowAnalyses: true } },
    );
  } else {
    await ExperimentSnapshotModel.updateOne(
      { organization, id },
      { $set: { analyses, hasOverflowAnalyses: false } },
    );
    // Clean up any stale overflow chunks from a previous larger write.
    await context.models.snapshotAnalysisOverflow.deleteForSnapshot(id);
  }
}

export async function updateSnapshotsOnPhaseDelete(
  context: Context,
  experiment: string,
  phase: number,
) {
  const organization = context.org.id;

  // Clean up overflow chunks for any snapshots about to be deleted.
  const overflowed = await ExperimentSnapshotModel.find(
    { organization, experiment, phase, hasOverflowAnalyses: true },
    { id: 1 },
  );
  await context.models.snapshotAnalysisOverflow.deleteForSnapshots(
    overflowed.map((d) => d.id),
  );

  // Delete all snapshots for the phase
  await ExperimentSnapshotModel.deleteMany({
    organization,
    experiment,
    phase,
  });

  // Decrement the phase index for all later phases
  await ExperimentSnapshotModel.updateMany(
    {
      organization,
      experiment,
      phase: {
        $gt: phase,
      },
    },
    {
      $inc: {
        phase: -1,
      },
    },
  );
}

export async function updateSnapshot({
  organization,
  id,
  updates,
  context,
}: {
  organization: string;
  id: string;
  updates: Partial<ExperimentSnapshotInterface>;
  context: Context;
}) {
  // If analyses are being written, divert them to the overflow collection when
  // they would push the document past the BSON size limit. Otherwise behavior
  // is identical to before.
  let overflowAnalyses: ExperimentSnapshotAnalysis[] | undefined;
  if (updates.analyses) {
    if (
      updates.analyses.length > 0 &&
      estimateJsonBytes(updates.analyses) >
        SNAPSHOT_ANALYSES_OVERFLOW_THRESHOLD_BYTES
    ) {
      overflowAnalyses = updates.analyses;
      // Write chunks before flipping the flag so a partial failure doesn't
      // leave the snapshot pointing at missing overflow data.
      await context.models.snapshotAnalysisOverflow.replaceForSnapshot(
        id,
        overflowAnalyses,
      );
      updates = { ...updates, analyses: [], hasOverflowAnalyses: true };
    } else {
      updates = { ...updates, hasOverflowAnalyses: false };
    }
  }

  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updates,
    },
  );

  if (updates.hasOverflowAnalyses === false) {
    // Analyses now fit inline; clean up any stale overflow chunks.
    await context.models.snapshotAnalysisOverflow.deleteForSnapshot(id);
  }

  const experimentSnapshotModel = await ExperimentSnapshotModel.findOne({
    id,
    organization,
  });
  if (!experimentSnapshotModel) throw "Internal error";

  // Downstream consumers (analysis summary, notifications, time series,
  // dashboards) read `analyses` off this doc, so hydrate when overflowed.
  if (experimentSnapshotModel.hasOverflowAnalyses) {
    experimentSnapshotModel.analyses =
      overflowAnalyses ??
      (await context.models.snapshotAnalysisOverflow.getAnalysesForSnapshot(
        id,
      ));
  }

  const shouldUpdateExperimentAnalysisSummary =
    experimentSnapshotModel.type === "standard" &&
    experimentSnapshotModel.status === "success";

  if (shouldUpdateExperimentAnalysisSummary) {
    const currentExperimentModel = await getExperimentById(
      context,
      experimentSnapshotModel.experiment,
    );

    const isLatestPhase = currentExperimentModel
      ? experimentSnapshotModel.phase ===
        currentExperimentModel.phases.length - 1
      : false;

    if (currentExperimentModel && isLatestPhase) {
      const updatedExperimentModel = await updateExperimentAnalysisSummary({
        context,
        experiment: currentExperimentModel,
        experimentSnapshot: experimentSnapshotModel,
      });

      const notificationsTriggered = await notifyExperimentChange({
        context,
        experiment: updatedExperimentModel,
        snapshot: experimentSnapshotModel,
        previousAnalysisSummary: currentExperimentModel.analysisSummary,
      });

      try {
        await updateExperimentTimeSeries({
          context,
          experiment: updatedExperimentModel,
          previousAnalysisSummary: currentExperimentModel.analysisSummary,
          experimentSnapshot: experimentSnapshotModel,
          notificationsTriggered,
        });
      } catch (error) {
        logger.error(
          {
            err: error,
            experimentId: currentExperimentModel.id,
            snapshotId: experimentSnapshotModel.id,
          },
          "Unable to update experiment time series",
        );
      }
    }
  }

  const updateDashboardWithSnapshot = async (dashboard: DashboardInterface) => {
    let updatedBlock = false;
    const blocks = dashboard.blocks.map((block) => {
      if (
        !blockHasFieldOfType(block, "snapshotId", isString) ||
        !snapshotSatisfiesBlock(experimentSnapshotModel, block)
      )
        return block;
      updatedBlock = true;
      return { ...block, snapshotId: experimentSnapshotModel.id };
    });
    if (updatedBlock) {
      await context.models.dashboards.dangerousUpdateBypassPermission(
        dashboard,
        {
          blocks,
        },
      );
    }
  };

  if (
    experimentSnapshotModel.status === "success" &&
    // Only use main snapshots or those triggered automatically for dashboards
    experimentSnapshotModel.triggeredBy !== "manual-dashboard" &&
    (experimentSnapshotModel.triggeredBy === "update-dashboards" ||
      experimentSnapshotModel.type === "standard")
  ) {
    const dashboards = await context.models.dashboards.findByExperiment(
      experimentSnapshotModel.experiment,
      { enableAutoUpdates: true },
    );
    for (const dashboard of dashboards) {
      await updateDashboardWithSnapshot(dashboard);
    }
  }
}

export type AddOrUpdateSnapshotAnalysisParams = {
  context: Context;
  organization: string;
  id: string;
  analysis: ExperimentSnapshotAnalysis;
};

// Loads the current full analyses array (from inline storage or overflow),
// applies the supplied mutation, and persists via the size-aware writer.
async function mutateSnapshotAnalyses(
  context: Context,
  organization: string,
  id: string,
  mutate: (analyses: ExperimentSnapshotAnalysis[]) => void,
) {
  const doc = await ExperimentSnapshotModel.findOne({ organization, id });
  if (!doc) throw "Internal error";

  const analyses: ExperimentSnapshotAnalysis[] = doc.hasOverflowAnalyses
    ? await context.models.snapshotAnalysisOverflow.getAnalysesForSnapshot(id)
    : [...(doc.analyses || [])];

  mutate(analyses);
  await writeAnalysesWithOverflow(context, organization, id, analyses);
}

export async function addOrUpdateSnapshotAnalysis(
  params: AddOrUpdateSnapshotAnalysisParams,
) {
  const { context, organization, id, analysis } = params;
  await mutateSnapshotAnalyses(context, organization, id, (analyses) => {
    const existingIndex = analyses.findIndex((a) =>
      isEqual(a.settings, analysis.settings),
    );
    if (existingIndex >= 0) {
      analyses[existingIndex] = analysis;
    } else {
      analyses.push(analysis);
    }
  });
}

export async function updateSnapshotAnalysis({
  context,
  organization,
  id,
  analysis,
}: AddOrUpdateSnapshotAnalysisParams) {
  await mutateSnapshotAnalyses(context, organization, id, (analyses) => {
    const existingIndex = analyses.findIndex((a) =>
      isEqual(a.settings, analysis.settings),
    );
    if (existingIndex >= 0) {
      analyses[existingIndex] = analysis;
    }
  });

  // Not notifying on new analysis because new analyses in an existing snapshot
  // are akin to ad-hoc snapshots
}

export async function deleteSnapshotById(context: Context, id: string) {
  await ExperimentSnapshotModel.deleteOne({
    organization: context.org.id,
    id,
  });
  await context.models.snapshotAnalysisOverflow.deleteForSnapshot(id);
}

export async function findSnapshotById(
  context: Context,
  id: string,
): Promise<ExperimentSnapshotInterface | null> {
  const doc = await ExperimentSnapshotModel.findOne({
    organization: context.org.id,
    id,
  });
  if (!doc) return null;
  return hydrateOverflowAnalyses(context, toInterface(doc));
}

export async function findSnapshotsByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<ExperimentSnapshotInterface[]> {
  const docs = await ExperimentSnapshotModel.find({
    organization: context.org.id,
    id: { $in: ids },
  });
  return hydrateOverflowAnalysesBatch(context, docs.map(toInterface));
}

export async function findRunningSnapshotsByQueryId(ids: string[]) {
  // Only look for matches in the past 24 hours to make the query more efficient
  // Older snapshots should not still be running anyway
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  const docs = await ExperimentSnapshotModel.find({
    status: "running",
    dateCreated: { $gt: earliestDate },
    queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
  });

  return docs.map((doc) => toInterface(doc));
}

export async function errorSnapshotIfStillRunning(
  organization: string,
  id: string,
  updates: Partial<ExperimentSnapshotInterface>,
): Promise<boolean> {
  const res = await ExperimentSnapshotModel.updateOne(
    { organization, id, status: "running" },
    { $set: { ...updates, status: "error" } },
  );
  return res.modifiedCount > 0;
}

export async function findStalledRunningSnapshots(
  stalledBefore: Date,
  limit: number,
) {
  // Only look back 24 hours to keep the scan bounded
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  const docs = await ExperimentSnapshotModel.find({
    status: "running",
    dateCreated: { $gt: earliestDate, $lt: stalledBefore },
  }).limit(limit);

  return docs.map((doc) => toInterface(doc));
}

export async function findLatestRunningSnapshotByReportId(
  context: Context,
  report: string,
) {
  // Only look for match in the past 24 hours to make the query more efficient
  // Older snapshots should not still be running anyway
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  const doc = await ExperimentSnapshotModel.findOne({
    organization: context.org.id,
    report,
    status: "running",
    dateCreated: { $gt: earliestDate },
    queries: { $elemMatch: { status: "running" } },
  });

  if (!doc) return null;
  return hydrateOverflowAnalyses(context, toInterface(doc));
}

export async function getLatestSnapshot({
  context,
  experiment,
  phase,
  dimension,
  beforeSnapshot,
  withResults = true,
  type,
}: {
  context: Context;
  experiment: string;
  phase: number;
  dimension?: string;
  beforeSnapshot?: ExperimentSnapshotDocument;
  withResults?: boolean;
  type?: SnapshotType;
}): Promise<ExperimentSnapshotInterface | null> {
  const query: FilterQuery<ExperimentSnapshotDocument> = {
    experiment,
    phase,
    dimension: dimension || null,
  };
  if (type) {
    query.type = type;
  } else {
    // never include report types unless specifically looking for them
    query.type = { $ne: "report" };
  }

  // FIXME: This is a hack to prefer running snapshots over schedules failed ones
  // We need to have a more robust solution for this and be opinionated on how we surface
  // different results that are generated by different systems (manual vs scheduled)
  //
  // This avoids showing errors from a scheduled run over an in-progress run in the UI.
  const shouldPreferRunningOverScheduledError =
    !type && !withResults && !beforeSnapshot;

  // First try getting new snapshots that have a `status` field
  let all = await ExperimentSnapshotModel.find(
    {
      ...query,
      status: {
        $in: withResults ? ["success"] : ["success", "running", "error"],
      },
      ...(beforeSnapshot
        ? { dateCreated: { $lt: beforeSnapshot.dateCreated } }
        : {}),
    },
    null,
    {
      sort: { dateCreated: -1 },
      limit: 1,
    },
  ).exec();

  if (all[0]) {
    const mostRecentSnapshot = all[0];

    if (
      shouldPreferRunningOverScheduledError &&
      mostRecentSnapshot.status === "error" &&
      mostRecentSnapshot.triggeredBy === "schedule"
    ) {
      // Avoid fetching stale snapshots
      const windowToConsider = new Date(
        mostRecentSnapshot.dateCreated.getTime() - 5 * 60 * 60 * 1000,
      );
      const runningSnapshot = await ExperimentSnapshotModel.findOne(
        {
          ...query,
          status: "running",
          dateCreated: {
            $lt: mostRecentSnapshot.dateCreated,
            $gt: windowToConsider,
          },
        },
        null,
        {
          sort: { dateCreated: -1 },
        },
      ).exec();

      if (runningSnapshot) {
        return hydrateOverflowAnalyses(context, toInterface(runningSnapshot));
      }
    }

    return hydrateOverflowAnalyses(context, toInterface(mostRecentSnapshot));
  }

  // Otherwise, try getting old snapshot records
  if (withResults) {
    query.results = { $exists: true, $type: "array", $ne: [] };
  }

  all = await ExperimentSnapshotModel.find(query, null, {
    sort: { dateCreated: -1 },
    limit: 1,
  }).exec();

  return all[0] ? hydrateOverflowAnalyses(context, toInterface(all[0])) : null;
}

// Gets latest snapshots per experiment-phase pair
export async function getLatestSnapshotMultipleExperiments(
  context: Context,
  experimentPhaseMap: Map<string, number>,
  dimension?: string,
  withResults: boolean = true,
): Promise<ExperimentSnapshotInterface[]> {
  const experimentPhasesToGet = new Map(experimentPhaseMap);
  const query: FilterQuery<ExperimentSnapshotDocument> = {
    experiment: { $in: Array.from(experimentPhasesToGet.keys()) },
    dimension: dimension || null,
    ...(withResults
      ? {
          $or: [
            { status: "success" },
            // get old snapshots if status field is missing
            { results: { $exists: true, $type: "array", $ne: [] } },
          ],
        }
      : {}),
  };

  const aggregatePipeline: PipelineStage[] = [
    // find all snapshots for those experiments matching dimension and result status
    { $match: query },
    // sort so latest is first
    { $sort: { dateCreated: -1 } },
    // group by experiment-phase and call latest snapshot `latestSnapshot`
    {
      $group: {
        _id: { experiment: "$experiment", phase: "$phase" },
        latestSnapshot: { $first: "$$ROOT" },
      },
    },
    // take latest snapshot and put it at the top level so we return an array of snapshots
    {
      $replaceRoot: { newRoot: "$latestSnapshot" },
    },
  ];

  const all =
    await ExperimentSnapshotModel.aggregate<ExperimentSnapshotDocument>(
      aggregatePipeline,
    ).exec();

  const snapshots: ExperimentSnapshotInterface[] = [];
  if (all[0]) {
    // get interfaces matching the right phase
    all.forEach((doc) => {
      // aggregate returns document directly, no need for toJSON
      const snapshot = migrateSnapshot(omit(doc, ["__v", "_id"]));
      const desiredPhase = experimentPhaseMap.get(snapshot.experiment);
      if (desiredPhase !== undefined && snapshot.phase === desiredPhase) {
        snapshots.push(snapshot);
        experimentPhasesToGet.delete(snapshot.experiment);
      }
    });
  }

  return hydrateOverflowAnalysesBatch(context, snapshots);
}

export async function createExperimentSnapshotModel({
  context,
  data,
}: {
  context: Context;
  data: ExperimentSnapshotInterface;
}): Promise<ExperimentSnapshotInterface> {
  const analyses = data.analyses;
  const overflow =
    analyses.length > 0 &&
    estimateJsonBytes(analyses) > SNAPSHOT_ANALYSES_OVERFLOW_THRESHOLD_BYTES;

  if (overflow) {
    // Write chunks before flipping the flag so a partial failure doesn't
    // leave the snapshot pointing at missing overflow data.
    await context.models.snapshotAnalysisOverflow.replaceForSnapshot(
      data.id,
      analyses,
    );
  }

  const created = await ExperimentSnapshotModel.create({
    ...data,
    analyses: overflow ? [] : analyses,
    hasOverflowAnalyses: overflow,
  });
  const snapshot = toInterface(created);
  if (overflow) snapshot.analyses = analyses;
  return snapshot;
}

export const getDefaultAnalysisResults = (
  snapshot: ExperimentSnapshotDocument,
) => snapshot.analyses?.[0]?.results?.[0];
