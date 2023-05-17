import mongoose, { FilterQuery } from "mongoose";
import omit from "lodash/omit";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  ExperimentSnapshotInterface,
  LegacyExperimentSnapshotInterface,
} from "../../types/experiment-snapshot";
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

const ExperimentSnapshotModel = mongoose.model<ExperimentSnapshotDocument>(
  "ExperimentSnapshot",
  experimentSnapshotSchema
);

const toInterface = (
  doc: ExperimentSnapshotDocument
): ExperimentSnapshotInterface =>
  migrateSnapshot(omit(doc.toJSON(), ["__v", "_id"]));

export function migrateSnapshot(
  orig: LegacyExperimentSnapshotInterface
): ExperimentSnapshotInterface {
  const {
    activationMetric,
    statsEngine,
    // eslint-disable-next-line
    hasRawQueries,
    // eslint-disable-next-line
    hasCorrectedStats,
    // eslint-disable-next-line
    query,
    results,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    sequentialTestingEnabled,
    sequentialTestingTuningParameter,
    queryFilter,
    segment,
    skipPartialData,
    manual,
    ...snapshot
  } = orig;

  // Convert old results to new array of analyses
  if (!snapshot.analyses) {
    if (results) {
      const regressionAdjusted =
        regressionAdjustmentEnabled &&
        metricRegressionAdjustmentStatuses?.some(
          (s) => s.regressionAdjustmentEnabled
        )
          ? true
          : false;

      snapshot.analyses = [
        {
          dateCreated: snapshot.dateCreated,
          status: snapshot.error ? "error" : "success",
          error: snapshot.error,
          settings: {
            statsEngine: statsEngine || "bayesian",
            dimensions: snapshot.dimension ? [snapshot.dimension] : [],
            pValueCorrection: null,
            regressionAdjusted,
            sequentialTesting: !!sequentialTestingEnabled,
            sequentialTestingTuningParameter:
              sequentialTestingTuningParameter ||
              DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
          },
          results,
        },
      ];
    } else {
      snapshot.analyses = [];
    }
  }

  // Figure out status from old fields
  if (!snapshot.status) {
    snapshot.status = snapshot.error
      ? "error"
      : snapshot.analyses.length > 0
      ? "success"
      : "running";
  }

  // Migrate settings
  // We weren't tracking all of these before, so just pick good defaults
  if (!snapshot.settings) {
    // Try to figure out metric ids from results
    const metricIds = Object.keys(results?.[0]?.variations?.[0]?.metrics || {});

    snapshot.settings = {
      manual: !!manual,
      dimensions: snapshot.dimension
        ? [
            {
              id: snapshot.dimension,
            },
          ]
        : [],
      // We know the list of metric ids, but don't know if they were goals or guardrails
      // Just add them all as goals (doesn't really change much)
      goalMetrics: metricIds.map((id) => ({ id })),
      guardrailMetrics: [],
      activationMetric: activationMetric ? { id: activationMetric } : null,
      regressionAdjustmentEnabled: true,

      startDate: snapshot.dateCreated,
      endDate: snapshot.dateCreated,
      experimentId: "",
      datasourceId: "",
      exposureQuery: "",
      queryFilter: queryFilter || "",
      segment: segment || "",
      skipPartialData: !!skipPartialData,
      attributionModel: "firstExposure",
    };
  }

  return snapshot;
}

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
