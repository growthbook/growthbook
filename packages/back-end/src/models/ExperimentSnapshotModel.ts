import mongoose, { FilterQuery, PipelineStage } from "mongoose";
import omit from "lodash/omit";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { migrateSnapshot } from "back-end/src/util/migrations";
import { notifyExperimentChange } from "back-end/src/services/experimentNotifications";
import { queriesSchema } from "./QueryModel";
import { Context } from "./BaseModel";

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

const ExperimentSnapshotModel = mongoose.model<LegacyExperimentSnapshotInterface>(
  "ExperimentSnapshot",
  experimentSnapshotSchema
);

const toInterface = (
  doc: ExperimentSnapshotDocument
): ExperimentSnapshotInterface =>
  migrateSnapshot(
    omit(doc.toJSON<ExperimentSnapshotDocument>(), ["__v", "_id"])
  );

export async function updateSnapshotsOnPhaseDelete(
  organization: string,
  experiment: string,
  phase: number
) {
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
    }
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
  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updates,
    }
  );

  const experimentSnapshotModel = await ExperimentSnapshotModel.findOne({
    id,
    organization,
  });
  if (!experimentSnapshotModel) throw "Internal error";

  await notifyExperimentChange({
    context,
    snapshot: experimentSnapshotModel,
  });
}

export type AddOrUpdateSnapshotAnalysisParams = {
  organization: string;
  id: string;
  analysis: ExperimentSnapshotAnalysis;
};

export async function addOrUpdateSnapshotAnalysis(
  params: AddOrUpdateSnapshotAnalysisParams
) {
  const { organization, id, analysis } = params;
  // looks for snapshots with this ID but WITHOUT these analysis settings
  const experimentSnapshotModel = await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
      "analyses.settings": { $ne: analysis.settings },
    },
    {
      $push: { analyses: analysis },
    }
  );
  // if analysis already exist, no documents will be returned by above query
  // so instead find and update existing analysis in DB
  if (experimentSnapshotModel.matchedCount === 0) {
    await updateSnapshotAnalysis({ organization, id, analysis });
  }
}

export async function updateSnapshotAnalysis({
  organization,
  id,
  analysis,
}: {
  organization: string;
  id: string;
  analysis: ExperimentSnapshotAnalysis;
}) {
  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
      "analyses.settings": analysis.settings,
    },
    {
      $set: { "analyses.$": analysis },
    }
  );

  const experimentSnapshotModel = await ExperimentSnapshotModel.findOne({
    id,
    organization,
  });
  if (!experimentSnapshotModel) throw "Internal error";

  // Not notifying on new analysis because new analyses in an existing snapshot
  // are akin to ad-hoc snapshots
  // await notifyExperimentChange({
  //   context,
  //   snapshot: experimentSnapshotModel,
  // });
}

export async function deleteSnapshotById(organization: string, id: string) {
  await ExperimentSnapshotModel.deleteOne({ organization, id });
}

export async function findSnapshotById(
  organization: string,
  id: string
): Promise<ExperimentSnapshotInterface | null> {
  const doc = await ExperimentSnapshotModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
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

export async function getLatestSnapshot({
  experiment,
  phase,
  dimension,
  beforeSnapshot,
  withResults = true,
  type,
}: {
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
  }

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
    }
  ).exec();

  if (all[0]) {
    return toInterface(all[0]);
  }

  // Otherwise, try getting old snapshot records
  if (withResults) {
    query.results = { $exists: true, $type: "array", $ne: [] };
  }

  all = await ExperimentSnapshotModel.find(query, null, {
    sort: { dateCreated: -1 },
    limit: 1,
  }).exec();

  return all[0] ? toInterface(all[0]) : null;
}

// Gets latest snapshots per experiment-phase pair
export async function getLatestSnapshotMultipleExperiments(
  experimentPhaseMap: Map<string, number>,
  dimension?: string,
  withResults: boolean = true
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

  const all = await ExperimentSnapshotModel.aggregate<ExperimentSnapshotDocument>(
    aggregatePipeline
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

  return snapshots;
}

export async function createExperimentSnapshotModel({
  data,
  context,
}: {
  data: ExperimentSnapshotInterface;
  context: Context;
}): Promise<ExperimentSnapshotInterface> {
  const created = await ExperimentSnapshotModel.create(data);

  await notifyExperimentChange({ context, snapshot: created });

  return toInterface(created);
}

export const getDefaultAnalysisResults = (
  snapshot: ExperimentSnapshotDocument
) => snapshot.analyses?.[0]?.results?.[0];
