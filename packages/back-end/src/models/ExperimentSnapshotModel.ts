import mongoose, { FilterQuery } from "mongoose";
import omit from "lodash/omit";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
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
    }
  ]
});
experimentSnapshotSchema.index({
  experiment: 1,
  dateCreated: -1,
});

type ExperimentSnapshotDocument = mongoose.Document &
  ExperimentSnapshotInterface;

const ExperimentSnapshotModel = mongoose.model<ExperimentSnapshotDocument>(
  "ExperimentSnapshot",
  experimentSnapshotSchema
);

const toInterface = (
  doc: ExperimentSnapshotDocument
): ExperimentSnapshotInterface => omit(doc.toJSON(), ["__v", "_id"]);

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

  if (withResults) {
    query.results = { $exists: true, $type: "array", $ne: [] };
  }

  const all = await ExperimentSnapshotModel.find(query, null, {
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
