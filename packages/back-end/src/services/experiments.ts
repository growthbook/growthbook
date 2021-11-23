import { ExperimentDocument, ExperimentModel } from "../models/ExperimentModel";
import {
  SnapshotVariation,
  ExperimentSnapshotInterface,
} from "../../types/experiment-snapshot";
import { getMetricsByOrganization, insertMetric } from "../models/MetricModel";
import uniqid from "uniqid";
import { analyzeExperimentMetric } from "./stats";
import { addTags } from "./tag";
import { WatchModel } from "../models/WatchModel";
import { QueryMap } from "./queries";
import {
  PastExperimentResult,
  Dimension,
  ExperimentMetricQueryResponse,
} from "../types/Integration";
import {
  ExperimentSnapshotDocument,
  ExperimentSnapshotModel,
} from "../models/ExperimentSnapshotModel";
import { MetricInterface, MetricStats } from "../../types/metric";
import { ExperimentInterface } from "../../types/experiment";
import { PastExperiment } from "../../types/past-experiments";
import { FilterQuery } from "mongoose";
import { promiseAllChunks } from "../util/promise";
import { findDimensionById } from "../models/DimensionModel";
import { startExperimentAnalysis } from "./reports";

export function getExperimentsByOrganization(
  organization: string,
  project?: string
) {
  const query: FilterQuery<ExperimentDocument> = {
    organization,
  };

  if (project) {
    query.project = project;
  }

  return ExperimentModel.find(query);
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
    id: uniqid("met_"),
    ...data,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  if (data.tags && data.organization) {
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
  if (!data.organization) {
    throw new Error("Missing organization");
  }

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
      const key = generateTrackingKey(data.name || data.id || "", n);
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
  const phase = experiment.phases[phaseIndex];

  const metricMap = new Map<string, MetricInterface>();
  const allMetrics = await getMetricsByOrganization(experiment.organization);
  allMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  // Default variation values, override from SQL results if available
  const variations: SnapshotVariation[] = experiment.variations.map((v, i) => ({
    users: users[i],
    metrics: {},
  }));
  let srm = 0;

  await promiseAllChunks(
    Object.keys(metrics).map((m) => {
      const stats = metrics[m];
      const metric = metricMap.get(m);
      return async () => {
        if (!metric) return;
        const rows: ExperimentMetricQueryResponse = stats.map((s, i) => {
          return {
            ...s,
            dimension: "All",
            variation: experiment.variations[i].key || i + "",
          };
        });

        const res = await analyzeExperimentMetric(
          experiment.variations.map((v, i) => {
            return {
              id: v.key || i + "",
              weight: phase.variationWeights[i] || 0,
              name: v.name,
            };
          }),
          metric,
          rows,
          20
        );
        const data = res.dimensions[0];
        if (!data) return;
        data.variations.map((v, i) => {
          variations[i].metrics[m] = v;
        });
        srm = data.srm;
      };
    }),
    3
  );

  return {
    srm,
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
    dimension: null,
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

export async function parseDimensionId(
  dimension: string | undefined,
  organization: string
): Promise<Dimension | null> {
  if (dimension) {
    if (dimension.match(/^exp:/)) {
      return {
        type: "experiment",
        id: dimension.substr(4),
      };
    } else if (dimension.substr(0, 4) === "pre:") {
      return {
        // eslint-disable-next-line
        type: dimension.substr(4) as any,
      };
    } else {
      const obj = await findDimensionById(dimension, organization);
      if (obj) {
        return {
          type: "user",
          dimension: obj,
        };
      }
    }
  }
  return null;
}

export async function createSnapshot(
  experiment: ExperimentInterface,
  phaseIndex: number,
  dimensionId: string | null
) {
  const {
    trackingKey,
    metrics,
    guardrails,
    queryFilter,
    segment,
    activationMetric,
    datasource,
    userIdType,
    skipPartialData,
  } = experiment;
  const { dateStarted, dateEnded, variationWeights } = experiment.phases[
    phaseIndex
  ];

  const { queries, results } = await startExperimentAnalysis({
    organization: experiment.organization,
    trackingKey,
    userIdType,
    metrics,
    skipPartialData,
    guardrails,
    queryFilter,
    segment,
    activationMetric,
    datasource,
    dimension: dimensionId || undefined,
    endDate: dateEnded,
    startDate: dateStarted,
    variations: experiment.variations.map((v, i) => {
      return {
        id: v.key || i + "",
        name: v.name,
        weight: variationWeights[i] || 0,
      };
    }),
  });

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    runStarted: new Date(),
    error: "",
    dateCreated: new Date(),
    phase: phaseIndex,
    manual: false,
    queries,
    hasRawQueries: true,
    queryLanguage: "sql",
    dimension: dimensionId,
    results: results?.dimensions,
    unknownVariations: results?.unknownVariations || [],
    activationMetric: experiment.activationMetric || "",
    segment: experiment.segment || "",
    queryFilter: experiment.queryFilter || "",
    skipPartialData: experiment.skipPartialData || false,
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
    let el = experimentMap.get(e.experiment_id);
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
