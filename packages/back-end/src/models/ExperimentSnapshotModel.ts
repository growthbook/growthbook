import mongoose, { FilterQuery } from "mongoose";
import omit from "lodash/omit";
import {
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
} from "../../types/experiment-snapshot";
import { migrateSnapshot } from "../util/migrations";
import { queriesSchema } from "./QueryModel";

const experimentSnapshotSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  experiment: String,
  phase: Number,
  type: { type: String },
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

type ExperimentSnapshotDocument = mongoose.Document &
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

export async function updateSnapshot(
  organization: string,
  id: string,
  updates: Partial<ExperimentSnapshotInterface>
) {
  await ExperimentSnapshotModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updates,
    }
  );
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

export async function getLatestSnapshot(
  experiment: string,
  phase: number,
  dimension?: string,
  withResults: boolean = true
): Promise<ExperimentSnapshotInterface | null> {
  const query: FilterQuery<ExperimentSnapshotDocument> = {
    experiment,
    phase,
    dimension: dimension || null,
  };

  // First try getting new snapshots that have a `status` field
  let all = await ExperimentSnapshotModel.find(
    {
      ...query,
      status: {
        $in: withResults ? ["success"] : ["success", "running", "error"],
      },
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

export async function createExperimentSnapshotModel(
  data: ExperimentSnapshotInterface
): Promise<ExperimentSnapshotInterface> {
  const created = await ExperimentSnapshotModel.create(data);
  return toInterface(created);
}
