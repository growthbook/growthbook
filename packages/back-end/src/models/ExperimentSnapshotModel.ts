import mongoose, { FilterQuery, PipelineStage } from "mongoose";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import {
  snapshotSatisfiesBlock,
  blockHasFieldOfType,
  DashboardInterface,
} from "shared/enterprise";
import { isString } from "shared/util";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import {
  AnalysisKeyType,
  AnalysisMetaEntry,
  buildAnalysisKey,
} from "shared/snapshot-analysis-chunks";
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
  hasChunkedAnalyses: Boolean,
  chunkedAnalysesMeta: {
    type: Map,
    of: {
      _id: false,
      dimensions: [
        {
          _id: false,
          name: String,
          srm: Number,
          variationUsers: [Number],
        },
      ],
    },
  },
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
    covariateImbalance: {
      _id: false,
      isImbalanced: Boolean,
      pValueThreshold: Number,
      numGoalMetrics: Number,
      numGoalMetricsImbalanced: Number,
      numGuardrailMetrics: Number,
      numGuardrailMetricsImbalanced: Number,
      numSecondaryMetrics: Number,
      numSecondaryMetricsImbalanced: Number,
      metricVariationCovariateImbalanceResults: [
        {
          _id: false,
          metricId: String,
          variation: Number,
          isImbalanced: Boolean,
          baselineSampleSize: Number,
          variationSampleSize: Number,
          baselineMean: Number,
          variationMean: Number,
          baselineStandardError: Number,
          variationStandardError: Number,
          pValue: Number,
          errorMessage: String,
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

async function prepareSnapshotForAnalysisWrite({
  organization,
  id,
  doc,
}: {
  organization: string;
  id: string;
  doc: ExperimentSnapshotDocument;
}): Promise<ExperimentSnapshotInterface> {
  const legacySnapshot = omit(doc.toJSON<ExperimentSnapshotDocument>(), [
    "__v",
    "_id",
  ]) as LegacyExperimentSnapshotInterface;
  // `migrateSnapshot` adds missing analysisKeys by mutating the analysis
  // objects, so capture the raw on-disk legacy state before calling it.
  const keylessAnalysisPositions = getKeylessAnalysisPositions(
    legacySnapshot.analyses,
  );
  const legacyChunkedAnalysesMeta = getLegacyChunkedAnalysesMeta(
    legacySnapshot.chunkedAnalysesMeta,
  );
  const snapshot = migrateSnapshot(legacySnapshot);

  await persistLegacyAnalysisMigration({
    organization,
    id,
    snapshot,
    legacyChunkedAnalysesMeta,
    keylessAnalysisPositions,
  });

  return snapshot;
}

function getAnalysisIndexBySettings(
  analyses: ExperimentSnapshotAnalysis[],
  settings: ExperimentSnapshotAnalysis["settings"],
) {
  return analyses.findIndex((analysis) => isEqual(analysis.settings, settings));
}

async function populateSnapshotAnalyses(
  context: Context,
  snapshot: ExperimentSnapshotInterface,
): Promise<ExperimentSnapshotInterface>;
async function populateSnapshotAnalyses(
  context: Context,
  snapshots: ExperimentSnapshotInterface[],
): Promise<ExperimentSnapshotInterface[]>;
async function populateSnapshotAnalyses(
  context: Context,
  snapshotOrSnapshots:
    | ExperimentSnapshotInterface
    | ExperimentSnapshotInterface[],
): Promise<ExperimentSnapshotInterface | ExperimentSnapshotInterface[]> {
  const snapshots = Array.isArray(snapshotOrSnapshots)
    ? snapshotOrSnapshots
    : [snapshotOrSnapshots];

  await context.models.experimentSnapshotAnalysisChunks.populateChunkedAnalyses(
    snapshots,
  );
  return snapshotOrSnapshots;
}

async function chunkAndStripAnalyses({
  context,
  snapshotId,
  experimentId,
  analyses,
  settings,
}: {
  context: Context;
  snapshotId: string;
  experimentId: string;
  analyses: ExperimentSnapshotAnalysis[];
  settings: ExperimentSnapshotSettings;
}): Promise<{
  strippedAnalyses: ExperimentSnapshotAnalysis[];
  hasChunkedAnalyses: true;
  chunkedAnalysesMeta: Record<AnalysisKeyType, AnalysisMetaEntry>;
  metricIds: string[];
} | null> {
  const hasResults = analyses.some((a) => a.results?.length > 0);
  if (!hasResults) return null;

  const chunkWrite =
    await context.models.experimentSnapshotAnalysisChunks.writeAnalyses({
      snapshotId,
      experimentId,
      analyses,
      settings,
      scope: "all",
    });

  return {
    strippedAnalyses: analyses.map((a) => ({ ...a, results: [] })),
    hasChunkedAnalyses: true,
    chunkedAnalysesMeta: chunkWrite.chunkedAnalysesMeta,
    metricIds: chunkWrite.metricIds,
  };
}

export async function updateSnapshotsOnPhaseDelete(
  context: Context,
  experiment: string,
  phase: number,
) {
  const organization = context.org.id;

  // Delete associated chunks for snapshots being deleted. We avoid filtering
  // by `hasChunkedAnalyses` because single-analysis writers can race and leave
  // the on-disk flag stale-false while chunks still exist (see
  // `buildMetaOpsForAnalysisWrite`). `deleteBySnapshotIds` is a no-op for
  // snapshots without chunks, so enumerating all phase snapshots is safe.
  const snapshotsToDelete = await ExperimentSnapshotModel.find({
    organization,
    experiment,
    phase,
  }).select({ id: 1 });
  if (snapshotsToDelete.length) {
    await context.models.experimentSnapshotAnalysisChunks.deleteBySnapshotIds(
      snapshotsToDelete.map((s) => s.id),
    );
  }

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
  context,
  id,
  updates,
}: {
  context: Context;
  id: string;
  updates: Partial<ExperimentSnapshotInterface>;
}) {
  const organization = context.org.id;

  const existingSnapshotModel = await ExperimentSnapshotModel.findOne({
    organization,
    id,
  });
  if (!existingSnapshotModel) {
    throw "Cannot update snapshot that does not exist.";
  }

  const existingInterface = toInterface(existingSnapshotModel);
  const updatesForDb: Partial<ExperimentSnapshotInterface> = { ...updates };
  let deleteExistingChunksAfterUpdate = false;
  let chunkResult: Awaited<ReturnType<typeof chunkAndStripAnalyses>> = null;
  let experimentSnapshot: ExperimentSnapshotInterface = {
    ...existingInterface,
    ...updates,
  };

  const analysisUpdates = updates.analyses;
  const hasAnalysisUpdates = analysisUpdates !== undefined;

  // Normalize analysis keys up front: preserve keys by settings-match against
  // the existing on-disk analyses so in-place updates stay on the same
  // sub-path, mint fresh ones for analyses that don't match.
  const normalizedAnalyses = hasAnalysisUpdates
    ? analysisUpdates.map((analysis) => {
        const resolvedKey = resolveAnalysisKey(
          existingInterface.analyses,
          analysis,
        );
        return analysis.analysisKey === resolvedKey
          ? analysis
          : { ...analysis, analysisKey: resolvedKey };
      })
    : undefined;

  // If analyses have results, chunk them into separate documents
  if (normalizedAnalyses) {
    chunkResult = await chunkAndStripAnalyses({
      context,
      snapshotId: id,
      experimentId: experimentSnapshot.experiment,
      analyses: normalizedAnalyses,
      settings: experimentSnapshot.settings,
    });
  }

  if (chunkResult && normalizedAnalyses) {
    deleteExistingChunksAfterUpdate = chunkResult.metricIds.length === 0;
    // Clear results from the main document while keeping the logical snapshot
    // populated for post-success side effects below.
    updatesForDb.analyses = chunkResult.strippedAnalyses;
    updatesForDb.hasChunkedAnalyses = chunkResult.hasChunkedAnalyses;
    updatesForDb.chunkedAnalysesMeta = chunkResult.chunkedAnalysesMeta;
    experimentSnapshot = {
      ...experimentSnapshot,
      analyses: normalizedAnalyses,
      hasChunkedAnalyses: chunkResult.hasChunkedAnalyses,
      chunkedAnalysesMeta: chunkResult.chunkedAnalysesMeta,
    };
  } else if (normalizedAnalyses) {
    deleteExistingChunksAfterUpdate = true;
    updatesForDb.analyses = normalizedAnalyses;
    updatesForDb.hasChunkedAnalyses = false;
    updatesForDb.chunkedAnalysesMeta = {};
    experimentSnapshot = {
      ...experimentSnapshot,
      analyses: normalizedAnalyses,
      hasChunkedAnalyses: false,
      chunkedAnalysesMeta: {},
    };
  }

  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updatesForDb,
    },
  );

  if (deleteExistingChunksAfterUpdate) {
    await context.models.experimentSnapshotAnalysisChunks.deleteBySnapshotId(
      id,
    );
  }

  if (experimentSnapshot.hasChunkedAnalyses && !chunkResult) {
    await populateSnapshotAnalyses(context, experimentSnapshot);
  }

  const shouldUpdateExperimentAnalysisSummary =
    experimentSnapshot.type === "standard" &&
    experimentSnapshot.status === "success";

  if (shouldUpdateExperimentAnalysisSummary) {
    const currentExperimentModel = await getExperimentById(
      context,
      experimentSnapshot.experiment,
    );

    const isLatestPhase = currentExperimentModel
      ? experimentSnapshot.phase === currentExperimentModel.phases.length - 1
      : false;

    if (currentExperimentModel && isLatestPhase) {
      const updatedExperimentModel = await updateExperimentAnalysisSummary({
        context,
        experiment: currentExperimentModel,
        experimentSnapshot,
      });

      const notificationsTriggered = await notifyExperimentChange({
        context,
        experiment: updatedExperimentModel,
        snapshot: experimentSnapshot,
        previousAnalysisSummary: currentExperimentModel.analysisSummary,
      });

      try {
        await updateExperimentTimeSeries({
          context,
          experiment: updatedExperimentModel,
          previousAnalysisSummary: currentExperimentModel.analysisSummary,
          experimentSnapshot,
          notificationsTriggered,
        });
      } catch (error) {
        logger.error(
          {
            err: error,
            experimentId: currentExperimentModel.id,
            snapshotId: experimentSnapshot.id,
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
        !snapshotSatisfiesBlock(experimentSnapshot, block)
      )
        return block;
      updatedBlock = true;
      return { ...block, snapshotId: experimentSnapshot.id };
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
    experimentSnapshot.status === "success" &&
    // Only use main snapshots or those triggered automatically for dashboards
    experimentSnapshot.triggeredBy !== "manual-dashboard" &&
    (experimentSnapshot.triggeredBy === "update-dashboards" ||
      experimentSnapshot.type === "standard")
  ) {
    const dashboards = await context.models.dashboards.findByExperiment(
      experimentSnapshot.experiment,
      { enableAutoUpdates: true },
    );
    for (const dashboard of dashboards) {
      await updateDashboardWithSnapshot(dashboard);
    }
  }
}

export type AddOrUpdateSnapshotAnalysisParams = {
  context: Context;
  id: string;
  analysis: ExperimentSnapshotAnalysis;
};

export async function addOrUpdateSnapshotAnalysis(
  params: AddOrUpdateSnapshotAnalysisParams,
) {
  const { context, id, analysis } = params;
  const organization = context.org.id;

  // Read the existing snapshot so we can resolve analysisKey deterministically:
  // match by settings to keep in-place updates on the same sub-path, otherwise
  // use the caller's key (or mint one if missing) for the push.
  const existing = await ExperimentSnapshotModel.findOne({ organization, id });
  if (!existing) {
    throw "Cannot update snapshot analysis that does not exist.";
  }
  const existingInterface = await prepareSnapshotForAnalysisWrite({
    organization,
    id,
    doc: existing,
  });

  const existingIndex = getAnalysisIndexBySettings(
    existingInterface.analyses,
    analysis.settings,
  );
  const analysisKey =
    existingIndex !== -1
      ? existingInterface.analyses[existingIndex].analysisKey
      : analysis.analysisKey || buildAnalysisKey();
  const keyedAnalysis: ExperimentSnapshotAnalysis = {
    ...analysis,
    analysisKey,
  };

  // Write the analysis's chunk sub-path atomically. Scoped to
  // `data.<analysisKey>` so concurrent writers for other analyses never
  // contend on the same MongoDB field.
  const hasResults = keyedAnalysis.results.length > 0;
  const { metaEntry } =
    await context.models.experimentSnapshotAnalysisChunks.upsertAnalysis({
      snapshotId: id,
      experimentId: existingInterface.experiment,
      analysis: keyedAnalysis,
      settings: existingInterface.settings,
    });

  // Stripped copy of the analysis (results live in chunk docs once written).
  const strippedAnalysis: ExperimentSnapshotAnalysis = hasResults
    ? { ...keyedAnalysis, results: [] }
    : keyedAnalysis;

  // Decide whether resetting this analysis to empty should also flip the
  // top-level `hasChunkedAnalyses` flag off. Safe when no other analysis has
  // chunks on disk (per `existingInterface`). Benign race: a concurrent
  // populating writer re-sets the flag to true on their write. The meta wipe
  // is always scoped to `analysisKey` so concurrent writers for other keys
  // never lose their meta entry.
  const clearAllMeta =
    !hasResults && isLastPopulatedAnalysis(existingInterface, analysisKey);

  if (existingIndex === -1) {
    // New analysis: atomic $push guarded by $ne on settings (existing idiom)
    // to prevent double-inserts when two writers race on the same settings.
    const { setOps, unsetOps } = buildMetaOpsForAnalysisWrite({
      analysisKey,
      metaEntry,
      hasResults,
      clearAllMeta,
    });
    const updateDoc: Record<string, unknown> = {
      $push: { analyses: strippedAnalysis },
      $set: setOps,
    };
    if (Object.keys(unsetOps).length) updateDoc.$unset = unsetOps;
    const pushRes = await ExperimentSnapshotModel.updateOne(
      {
        organization,
        id,
        "analyses.settings": { $ne: keyedAnalysis.settings },
      },
      updateDoc,
    );
    if (pushRes.matchedCount === 0) {
      // A concurrent writer inserted the same-settings analysis first and
      // won the $push. `upsertAnalysis` already wrote our minted
      // `data.<analysisKey>` sub-path into every metric chunk, and those
      // would orphan forever (the winning writer owns a different key that
      // no one ever migrates to ours). Clean them up before delegating.
      await context.models.experimentSnapshotAnalysisChunks.removeAnalysisChunks(
        id,
        analysisKey,
      );
      await updateSnapshotAnalysis({ context, id, analysis });
    }
    return;
  }

  // Existing analysis: positional $set on the matched settings (existing
  // idiom) keeps the analysis doc aligned with its pre-existing position.
  const { setOps, unsetOps } = buildMetaOpsForAnalysisWrite({
    analysisKey,
    metaEntry,
    hasResults,
    clearAllMeta,
  });
  const updateDoc: Record<string, unknown> = {
    $set: { "analyses.$": strippedAnalysis, ...setOps },
  };
  if (Object.keys(unsetOps).length) updateDoc.$unset = unsetOps;
  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
      "analyses.settings": keyedAnalysis.settings,
    },
    updateDoc,
  );
}

export async function updateSnapshotAnalysis({
  context,
  id,
  analysis,
}: {
  context: Context;
  id: string;
  analysis: ExperimentSnapshotAnalysis;
}) {
  const organization = context.org.id;

  const existing = await ExperimentSnapshotModel.findOne({ organization, id });
  if (!existing) return;
  const existingInterface = await prepareSnapshotForAnalysisWrite({
    organization,
    id,
    doc: existing,
  });

  const existingIndex = getAnalysisIndexBySettings(
    existingInterface.analyses,
    analysis.settings,
  );
  if (existingIndex === -1) return;

  const analysisKey = existingInterface.analyses[existingIndex].analysisKey;
  const keyedAnalysis: ExperimentSnapshotAnalysis = {
    ...analysis,
    analysisKey,
  };

  const hasResults = keyedAnalysis.results.length > 0;
  const { metaEntry } =
    await context.models.experimentSnapshotAnalysisChunks.upsertAnalysis({
      snapshotId: id,
      experimentId: existingInterface.experiment,
      analysis: keyedAnalysis,
      settings: existingInterface.settings,
    });

  const strippedAnalysis: ExperimentSnapshotAnalysis = hasResults
    ? { ...keyedAnalysis, results: [] }
    : keyedAnalysis;

  const clearAllMeta =
    !hasResults && isLastPopulatedAnalysis(existingInterface, analysisKey);
  const { setOps, unsetOps } = buildMetaOpsForAnalysisWrite({
    analysisKey,
    metaEntry,
    hasResults,
    clearAllMeta,
  });
  const updateDoc: Record<string, unknown> = {
    $set: { "analyses.$": strippedAnalysis, ...setOps },
  };
  if (Object.keys(unsetOps).length) updateDoc.$unset = unsetOps;

  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
      "analyses.settings": keyedAnalysis.settings,
    },
    updateDoc,
  );

  // Not notifying on new analysis because new analyses in an existing snapshot
  // are akin to ad-hoc snapshots
}

export async function deleteSnapshotById(context: Context, id: string) {
  await context.models.experimentSnapshotAnalysisChunks.deleteBySnapshotId(id);
  await ExperimentSnapshotModel.deleteOne({
    organization: context.org.id,
    id,
  });
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
  const snapshot = toInterface(doc);
  return populateSnapshotAnalyses(context, snapshot);
}

export async function findSnapshotsByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<ExperimentSnapshotInterface[]> {
  const docs = await ExperimentSnapshotModel.find({
    organization: context.org.id,
    id: { $in: ids },
  });
  const snapshots = docs.map(toInterface);
  return populateSnapshotAnalyses(context, snapshots);
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
  context: Context,
  id: string,
  updates: Partial<ExperimentSnapshotInterface>,
): Promise<boolean> {
  const res = await ExperimentSnapshotModel.updateOne(
    {
      organization: context.org.id,
      id,
      status: "running",
    },
    { $set: { ...updates, status: "error" } },
  );
  return res.modifiedCount > 0;
}

export async function dangerousFindStalledRunningSnapshotsFromAllOrgs(
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

  return doc ? toInterface(doc) : null;
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
  beforeSnapshot?: Pick<ExperimentSnapshotInterface, "dateCreated">;
  withResults?: boolean;
  type?: SnapshotType;
}): Promise<ExperimentSnapshotInterface | null> {
  const query: FilterQuery<ExperimentSnapshotDocument> = {
    organization: context.org.id,
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
        return populateSnapshotAnalyses(context, toInterface(runningSnapshot));
      }
    }

    return populateSnapshotAnalyses(context, toInterface(mostRecentSnapshot));
  }

  // Otherwise, try getting old snapshot records
  if (withResults) {
    query.results = { $exists: true, $type: "array", $ne: [] };
  }

  all = await ExperimentSnapshotModel.find(query, null, {
    sort: { dateCreated: -1 },
    limit: 1,
  }).exec();

  return all[0] ? populateSnapshotAnalyses(context, toInterface(all[0])) : null;
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
    organization: context.org.id,
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

  return populateSnapshotAnalyses(context, snapshots);
}

export async function createExperimentSnapshotModel({
  context,
  data,
}: {
  context: Context;
  data: ExperimentSnapshotInterface;
}): Promise<ExperimentSnapshotInterface> {
  const hasPopulatedAnalysisResults = data.analyses.some(
    (analysis) => analysis.results?.length > 0,
  );
  if (data.hasChunkedAnalyses && !hasPopulatedAnalysisResults) {
    throw new Error("Snapshot already has chunked analyses.");
  }

  const snapshotData = omit(data, [
    "hasChunkedAnalyses",
    "chunkedAnalysesMeta",
  ]);
  const chunkResult = await chunkAndStripAnalyses({
    context,
    snapshotId: snapshotData.id,
    experimentId: snapshotData.experiment,
    analyses: snapshotData.analyses,
    settings: snapshotData.settings,
  });
  const snapshotForDb = chunkResult
    ? {
        ...snapshotData,
        analyses: chunkResult.strippedAnalyses,
        hasChunkedAnalyses: chunkResult.hasChunkedAnalyses,
        chunkedAnalysesMeta: chunkResult.chunkedAnalysesMeta,
      }
    : snapshotData;

  const created = await ExperimentSnapshotModel.create(snapshotForDb);
  const createdSnapshot = toInterface(created);

  // Populate analyses results from memory instead of recreating
  // from chunks which would involve more DB calls
  return chunkResult
    ? {
        ...createdSnapshot,
        analyses: snapshotData.analyses,
      }
    : createdSnapshot;
}

export const getDefaultAnalysisResults = (
  snapshot: ExperimentSnapshotDocument,
) => snapshot.analyses?.[0]?.results?.[0];

function resolveAnalysisKey(
  existing: ExperimentSnapshotAnalysis[],
  analysis: ExperimentSnapshotAnalysis,
): string {
  if (
    analysis.analysisKey &&
    existing.some((a) => a.analysisKey === analysis.analysisKey)
  ) {
    return analysis.analysisKey;
  }

  const existingIndex = getAnalysisIndexBySettings(existing, analysis.settings);
  if (existingIndex !== -1) return existing[existingIndex].analysisKey;
  return analysis.analysisKey || buildAnalysisKey();
}

// Returns true if every analysis key other than `ignoreKey` has no dimensions
// in meta. Used to decide whether clearing a single analysis leaves nothing
// chunked (so we can clear `hasChunkedAnalyses`/meta). Benign race: if a
// concurrent writer is populating another key, they set the flag back to true
// on their write, so the worst case is a transient stale `hasChunkedAnalyses`.
function isLastPopulatedAnalysis(
  snapshot: ExperimentSnapshotInterface,
  ignoreKey: string,
): boolean {
  const meta = snapshot.chunkedAnalysesMeta ?? {};
  for (const [key, entry] of Object.entries(meta)) {
    if (key === ignoreKey) continue;
    if (entry?.dimensions?.length) return false;
  }
  return true;
}

function getLegacyChunkedAnalysesMeta(
  chunkedAnalysesMeta: unknown,
): unknown[] | Record<string, unknown> | undefined {
  const NUMBER_REGEX = /^\d+$/;
  if (Array.isArray(chunkedAnalysesMeta)) return chunkedAnalysesMeta;
  if (
    chunkedAnalysesMeta != undefined &&
    typeof chunkedAnalysesMeta === "object" &&
    Object.keys(chunkedAnalysesMeta).length > 0 &&
    Object.keys(chunkedAnalysesMeta).every((k) => NUMBER_REGEX.test(k))
  ) {
    return chunkedAnalysesMeta as Record<string, unknown>;
  }
}

function getKeylessAnalysisPositions(analyses: unknown): number[] {
  if (!Array.isArray(analyses)) return [];

  return analyses.flatMap((analysis, position) => {
    if (!analysis || typeof analysis !== "object") return [position];
    const analysisKey = (analysis as { analysisKey?: unknown }).analysisKey;
    return typeof analysisKey === "string" && analysisKey ? [] : [position];
  });
}

async function persistLegacyAnalysisMigration({
  organization,
  id,
  snapshot,
  legacyChunkedAnalysesMeta,
  keylessAnalysisPositions,
}: {
  organization: string;
  id: string;
  snapshot: ExperimentSnapshotInterface;
  legacyChunkedAnalysesMeta?: unknown[] | Record<string, unknown>;
  keylessAnalysisPositions: number[];
}) {
  const setOps: Record<string, unknown> = {};

  if (
    legacyChunkedAnalysesMeta !== undefined ||
    keylessAnalysisPositions.length > 0
  ) {
    setOps.chunkedAnalysesMeta = snapshot.chunkedAnalysesMeta ?? {};
  }

  for (const position of keylessAnalysisPositions) {
    const analysis = snapshot.analyses[position];
    if (analysis?.analysisKey) {
      setOps[`analyses.${position}.analysisKey`] = analysis.analysisKey;
    }
  }

  if (!Object.keys(setOps).length) return;

  const filter: Record<string, unknown> = {
    organization,
    id,
  };
  if (legacyChunkedAnalysesMeta !== undefined) {
    filter.$or = [
      { chunkedAnalysesMeta: { $type: "array" } },
      { chunkedAnalysesMeta: legacyChunkedAnalysesMeta },
    ];
  }

  await ExperimentSnapshotModel.collection.updateOne(filter, {
    $set: setOps,
  });
}

// Build the meta mutation operators for a single-analysis write. The meta
// sub-path (`chunkedAnalysesMeta.<analysisKey>`) is always keyed off
// `analysisKey` — writers for other keys never contend on the same field, so
// a concurrent writer's meta survives our clear. The `hasChunkedAnalyses`
// flag is still written best-effort (benign race; see `migrateSnapshot` for
// read-time derivation safety).
function buildMetaOpsForAnalysisWrite({
  analysisKey,
  metaEntry,
  hasResults,
  clearAllMeta,
}: {
  analysisKey: string;
  metaEntry: AnalysisMetaEntry;
  hasResults: boolean;
  clearAllMeta: boolean;
}): {
  setOps: Record<string, unknown>;
  unsetOps: Record<string, unknown>;
} {
  if (clearAllMeta) {
    return {
      setOps: { hasChunkedAnalyses: false },
      unsetOps: { [`chunkedAnalysesMeta.${analysisKey}`]: "" },
    };
  }
  return {
    setOps: {
      [`chunkedAnalysesMeta.${analysisKey}`]: metaEntry,
      ...(hasResults ? { hasChunkedAnalyses: true } : {}),
    },
    unsetOps: {},
  };
}
