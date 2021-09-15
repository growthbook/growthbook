import { ExperimentModel } from "../models/ExperimentModel";
import {
  SnapshotVariation,
  ExperimentSnapshotInterface,
} from "../../types/experiment-snapshot";
import { getMetricsByOrganization, insertMetric } from "../models/MetricModel";
import uniqid from "uniqid";
import { srm, ABTestStats, abtest, getValueCR } from "./stats";
import { getSourceIntegrationObject } from "./datasource";
import { addTags } from "./tag";
import { WatchModel } from "../models/WatchModel";
import {
  getExperimentMetric,
  getExperimentResults,
  getExperimentUsers,
  QueryMap,
  startRun,
} from "./queries";
import {
  DimensionResult,
  ExperimentMetricResult,
  ExperimentUsersResult,
  PastExperimentResult,
} from "../types/Integration";
import {
  ExperimentSnapshotDocument,
  ExperimentSnapshotModel,
} from "../models/ExperimentSnapshotModel";
import { MetricInterface, MetricStats } from "../../types/metric";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { DimensionInterface } from "../../types/dimension";
import { DataSourceInterface } from "../../types/datasource";
import { PastExperiment } from "../../types/past-experiments";
import { QueryDocument } from "../models/QueryModel";
import { FilterQuery } from "mongoose";

export function getExperimentsByOrganization(organization: string) {
  return ExperimentModel.find({
    organization,
  });
}
export async function getExperimentById(id: string) {
  const experiment = await ExperimentModel.findOne({
    id,
  });
  return experiment;
}

export function getExperimentByTrackingKey(
  organization: string,
  trackingKey: string
) {
  return ExperimentModel.findOne({
    organization,
    trackingKey,
  });
}

export async function getExperimentsByIds(ids: string[]) {
  return ExperimentModel.find({
    id: { $in: ids },
  });
}

export function deleteExperimentById(id: string) {
  return ExperimentModel.deleteOne({
    id,
  });
}

export async function getLatestSnapshot(
  experiment: string,
  phase: number,
  dimension?: string,
  withResults: boolean = true
) {
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

  return all[0];
}

export async function createMetric(data: Partial<MetricInterface>) {
  const metric = insertMetric({
    ...data,
    id: uniqid("met_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  if (data.tags) {
    await addTags(data.organization, data.tags);
  }

  return metric;
}

function generateTrackingKey(name: string, n: number): string {
  let key = ("-" + name)
    .toLowerCase()
    // Replace whitespace with hyphen
    .replace(/\s+/g, "-")
    // Get rid of all non alpha-numeric characters
    .replace(/[^a-z0-9\-_]*/g, "")
    // Remove stopwords
    .replace(
      /-((a|about|above|after|again|all|am|an|and|any|are|arent|as|at|be|because|been|before|below|between|both|but|by|cant|could|did|do|does|dont|down|during|each|few|for|from|had|has|have|having|here|how|if|in|into|is|isnt|it|its|itself|more|most|no|nor|not|of|on|once|only|or|other|our|out|over|own|same|should|shouldnt|so|some|such|that|than|then|the|there|theres|these|this|those|through|to|too|under|until|up|very|was|wasnt|we|weve|were|what|whats|when|where|which|while|who|whos|whom|why|with|wont|would)-)+/g,
      "-"
    )
    // Collapse duplicate hyphens
    .replace(/-{2,}/g, "-")
    // Remove leading and trailing hyphens
    .replace(/(^-|-$)/g, "");

  // Add number if this is not the first attempt
  if (n > 1) {
    key += "-" + n;
  }

  return key;
}

export async function createExperiment(data: Partial<ExperimentInterface>) {
  if (data.trackingKey) {
    // Make sure id is unique
    const existing = await getExperimentByTrackingKey(
      data.organization,
      data.trackingKey
    );
    if (existing) {
      throw new Error(
        "Error: Duplicate tracking key. Please choose something else"
      );
    }
  } else {
    // Try to generate a unique tracking key based on the experiment name
    let n = 1;
    let found = null;
    while (n < 10 && !found) {
      const key = generateTrackingKey(data.name, n);
      if (!(await getExperimentByTrackingKey(data.organization, key))) {
        found = key;
      }
      n++;
    }

    // Fall back to uniqid if couldn't generate
    data.trackingKey = found || uniqid();
  }

  const exp = await ExperimentModel.create({
    ...data,
    id: uniqid("exp_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    autoSnapshots: true,
    lastSnapshotAttempt: new Date(),
  });

  if (data.tags) {
    await addTags(data.organization, data.tags);
  }

  return exp;
}

export async function getManualSnapshotData(
  experiment: ExperimentInterface,
  phaseIndex: number,
  users: number[],
  metrics: {
    [key: string]: MetricStats[];
  }
) {
  // Default variation values, override from SQL results if available
  const variations: SnapshotVariation[] = experiment.variations.map((v, i) => ({
    users: users[i],
    metrics: {},
  }));

  const phase = experiment.phases[phaseIndex];

  const metricMap = new Map<string, MetricInterface>();
  const allMetrics = await getMetricsByOrganization(experiment.organization);
  allMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  await Promise.all(
    Object.keys(metrics).map((m) => {
      const metric = metricMap.get(m);
      return Promise.all(
        experiment.variations.map(async (v, i) => {
          const valueCR = getValueCR(
            metric,
            metrics[m][i].mean * metrics[m][i].count,
            metrics[m][i].count,
            users[i]
          );

          // Baseline
          if (!i) {
            variations[i].metrics[m] = {
              ...valueCR,
              stats: metrics[m][i],
            };
          }
          // Variation
          else {
            const result = await abtest(
              metric,
              users[0],
              metrics[m][0],
              users[i],
              metrics[m][i]
            );

            variations[i].metrics[m] = {
              ...valueCR,
              ...result,
              stats: metrics[m][i],
            };
          }
        })
      );
    })
  );

  // Check to see if the observed number of samples per variation matches what we expect
  // This returns a p-value and a small value indicates the results are untrustworthy
  const sampleRatioMismatch = srm(
    variations.map((v) => v.users),
    phase.variationWeights
  );

  return {
    srm: sampleRatioMismatch,
    variations,
  };
}

export async function createManualSnapshot(
  experiment: ExperimentInterface,
  phaseIndex: number,
  users: number[],
  metrics: {
    [key: string]: MetricStats[];
  }
) {
  const { srm, variations } = await getManualSnapshotData(
    experiment,
    phaseIndex,
    users,
    metrics
  );

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    phase: phaseIndex,
    queries: [],
    runStarted: new Date(),
    dateCreated: new Date(),
    manual: true,
    results: [
      {
        name: "All",
        srm,
        variations,
      },
    ],
  };

  const snapshot = await ExperimentSnapshotModel.create(data);

  return snapshot;
}

type ProcessedSnapshotDimension = {
  name: string;
  srm: number;
  variations: SnapshotVariation[];
};
type ProcessedSnapshotData = {
  dimensions: ProcessedSnapshotDimension[];
  unknownVariations: string[];
};

export async function processSnapshotData(
  experiment: ExperimentInterface,
  phase: ExperimentPhase,
  queryData: QueryMap
): Promise<ProcessedSnapshotData> {
  const metrics = await getMetricsByOrganization(experiment.organization);
  const metricMap = new Map<string, MetricInterface>();
  metrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  // Combine user and metric data into a single data structure
  const combined: {
    [key: string]: {
      users: number[];
      metrics: {
        [key: string]: MetricStats[];
      };
    };
  } = {};

  let unknownVariations: string[] = [];

  // Everything done in a single query (Mixpanel, Google Analytics)
  if (queryData.has("results")) {
    const data = queryData.get("results").result as DimensionResult[];
    data.forEach((row) => {
      combined[row.dimension] = {
        users: [],
        metrics: {},
      };
      const d = combined[row.dimension];
      row.variations.forEach((v) => {
        d.users[v.variation] = v.users;
        v.metrics.forEach(({ metric, ...stats }) => {
          if (!d.metrics[metric]) d.metrics[metric] = [];
          d.metrics[metric][v.variation] = stats;
        });
      });
    });
  }
  // Spread out over multiple queries (SQL sources)
  else {
    // User counts
    const usersResult: ExperimentUsersResult = queryData.get("users")
      ?.result as ExperimentUsersResult;
    if (!usersResult) return { dimensions: [], unknownVariations: [] };
    usersResult.dimensions.forEach((d) => {
      combined[d.dimension] = { users: [], metrics: {} };
      d.variations.forEach((v) => {
        combined[d.dimension].users[v.variation] = v.users;
      });
    });

    unknownVariations = usersResult.unknownVariations || [];

    // Raw metric numbers
    queryData.forEach((obj, key) => {
      if (!metricMap.has(key)) return;
      const data = obj.result as ExperimentMetricResult;
      data.dimensions.forEach((d) => {
        if (!combined[d.dimension]) return;
        combined[d.dimension].metrics[key] = [];
        d.variations.forEach((v) => {
          combined[d.dimension].metrics[key][v.variation] = v.stats;
        });
      });
    });
  }

  const dimensions: ProcessedSnapshotDimension[] = [];

  await Promise.all(
    Object.keys(combined).map(async (dimension) => {
      const row = combined[dimension];
      // One doc per variation
      const variations: SnapshotVariation[] = experiment.variations.map(
        (v, i) => ({
          users: row.users[i] || 0,
          metrics: {},
        })
      );

      // Calculate metric stats
      const metricPromises: Promise<void[]>[] = [];
      Object.keys(row.metrics).forEach((k) => {
        const v = row.metrics[k];
        const baselineSuccess = v[0]?.count * v[0]?.mean || 0;

        metricPromises.push(
          Promise.all(
            v.map(async (data, i) => {
              const success = data.count * data.mean;

              const metric = metricMap.get(k);
              const value = success;

              // Don't do stats for the baseline
              if (!i) {
                variations[i].metrics[k] = {
                  ...getValueCR(metric, value, data.count, variations[i].users),
                  stats: data,
                };
                return;
              }

              let result: ABTestStats;
              // Short cut if either the baseline or variation has no data
              if (!baselineSuccess || !success) {
                result = {
                  buckets: [],
                  chanceToWin: 0,
                  ci: [0, 0],
                  risk: [0, 0],
                  expected: 0,
                };
              } else {
                result = await abtest(
                  metric,
                  variations[0].users,
                  v[0],
                  variations[i].users,
                  data
                );
              }

              variations[i].metrics[k] = {
                ...getValueCR(metric, value, data.count, variations[i].users),
                ...result,
                stats: data,
              };
            })
          )
        );
      });
      await Promise.all(metricPromises);

      // Check to see if the observed number of samples per variation matches what we expect
      // This returns a p-value and a small value indicates the results are untrustworthy
      const sampleRatioMismatch = srm(
        variations.map((v) => v.users),
        phase.variationWeights
      );

      dimensions.push({
        name: dimension,
        srm: sampleRatioMismatch,
        variations,
      });
    })
  );

  if (!dimensions.length) {
    dimensions.push({
      name: "All",
      srm: 1,
      variations: [],
    });
  }

  return {
    unknownVariations,
    dimensions,
  };
}

export async function createSnapshot(
  experiment: ExperimentInterface,
  phaseIndex: number,
  datasource: DataSourceInterface,
  userDimension?: DimensionInterface,
  experimentDimension?: string
) {
  const metrics = await getMetricsByOrganization(experiment.organization);
  const metricMap = new Map<string, MetricInterface>();
  metrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const activationMetric = metricMap.get(experiment.activationMetric) || null;

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = Array.from(
    new Set(experiment.metrics.concat(experiment.guardrails || []))
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m);
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const phase = experiment.phases[phaseIndex];

  // Update lastSnapshotAttempt
  experiment.lastSnapshotAttempt = new Date();
  await ExperimentModel.updateOne(
    {
      id: experiment.id,
    },
    {
      $set: {
        lastSnapshotAttempt: experiment.lastSnapshotAttempt,
      },
    }
  );

  const integration = getSourceIntegrationObject(datasource);

  const queryDocs: { [key: string]: Promise<QueryDocument> } = {};

  // Run it as a single synchronous task (non-sql datasources and legacy code)
  if (!integration.getSourceProperties().separateExperimentResultQueries) {
    queryDocs["results"] = getExperimentResults(
      integration,
      experiment,
      phase,
      selectedMetrics,
      activationMetric,
      userDimension
    );
  }
  // Run as multiple async queries (new way for sql datasources)
  else {
    queryDocs["users"] = getExperimentUsers(integration, {
      experiment,
      userDimension,
      experimentDimension,
      activationMetric,
      phase,
    });
    selectedMetrics.forEach((m) => {
      queryDocs[m.id] = getExperimentMetric(integration, {
        metric: m,
        experiment,
        userDimension,
        experimentDimension,
        activationMetric,
        phase,
      });
    });
  }

  const { queries, result: results } = await startRun(
    queryDocs,
    async (queryData) => processSnapshotData(experiment, phase, queryData)
  );

  const dimensionId =
    userDimension?.id ||
    (experimentDimension ? "exp:" + experimentDimension : null);

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    runStarted: new Date(),
    dateCreated: new Date(),
    phase: phaseIndex,
    manual: false,
    queries,
    hasRawQueries: true,
    queryLanguage: integration.getSourceProperties().queryLanguage,
    dimension: dimensionId,
    results: results?.dimensions,
    unknownVariations: results?.unknownVariations || [],
  };

  const snapshot = await ExperimentSnapshotModel.create(data);

  // After successful snapshot, turn on autosnapshots
  experiment.autoSnapshots = true;
  await ExperimentModel.updateOne(
    {
      id: experiment.id,
    },
    {
      $set: {
        autoSnapshots: true,
      },
    }
  );

  return snapshot;
}

export async function ensureWatching(
  userId: string,
  orgId: string,
  experiment: string
) {
  await WatchModel.updateOne(
    {
      userId,
      organization: orgId,
    },
    {
      $addToSet: {
        experiments: experiment,
      },
    },
    {
      upsert: true,
    }
  );
}

export async function getExperimentWatchers(experimentId: string) {
  const watchers = await WatchModel.find({
    experiment: experimentId,
  });
  return watchers;
}

export async function processPastExperiments(
  data: QueryMap
): Promise<PastExperiment[]> {
  const experiments =
    (data.get("experiments")?.result as PastExperimentResult)?.experiments ||
    [];

  const experimentMap = new Map<string, PastExperiment>();
  experiments.forEach((e) => {
    let el: PastExperiment = experimentMap.get(e.experiment_id);
    if (!el) {
      el = {
        endDate: e.end_date,
        startDate: e.start_date,
        numVariations: 1,
        variationKeys: [e.variation_id],
        trackingKey: e.experiment_id,
        users: e.users,
        weights: [e.users],
      };
      experimentMap.set(e.experiment_id, el);
    } else {
      if (e.start_date < el.startDate) {
        el.startDate = e.start_date;
      }
      if (e.end_date > el.endDate) {
        el.endDate = e.end_date;
      }
      el.variationKeys.push(e.variation_id);
      el.weights.push(e.users);
      el.users += e.users;
      el.numVariations++;
    }
  });

  // Round the weights
  const possibleWeights = [
    5,
    10,
    16,
    20,
    25,
    30,
    33,
    40,
    50,
    60,
    67,
    70,
    75,
    80,
    90,
    95,
  ];
  experimentMap.forEach((exp) => {
    const totalWeight = exp.weights.reduce((sum, weight) => sum + weight, 0);
    exp.weights = exp.weights.map((w) => {
      // Map the observed percentage traffic to the closest reasonable number
      const p = Math.round((w / totalWeight) * 100);
      return possibleWeights
        .map((x) => [x, Math.abs(x - p)])
        .sort((a, b) => a[1] - b[1])[0][0];
    });

    // Make sure total weight adds to 1 (if not, increase the control until it does)
    const newTotalWeight = exp.weights.reduce((sum, weight) => sum + weight, 0);
    if (newTotalWeight < 100) {
      exp.weights[0] += 100 - newTotalWeight;
    }
    exp.weights = exp.weights.map((w) => w / 100);
  });

  // Filter out experiments with too few or too many variations
  return Array.from(experimentMap.values()).filter(
    (e) => e.numVariations > 1 && e.numVariations < 10
  );
}
