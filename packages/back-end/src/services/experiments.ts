import { ExperimentDocument, ExperimentModel } from "../models/ExperimentModel";
import {
  SnapshotVariation,
  ExperimentSnapshotInterface,
} from "../../types/experiment-snapshot";
import {
  getMetricsByOrganization,
  insertMetric,
  updateMetric,
} from "../models/MetricModel";
import uniqid from "uniqid";
import { analyzeExperimentMetric } from "./stats";
import { checkSrm } from "../util/stats";
import { getSourceIntegrationObject } from "./datasource";
import { addTags } from "../models/TagModel";
import { WatchModel } from "../models/WatchModel";
import { getMetricValue, QueryMap, startRun } from "./queries";
import {
  PastExperimentResult,
  Dimension,
  ExperimentMetricQueryResponse,
  MetricValueResult,
  MetricValueParams,
} from "../types/Integration";
import {
  ExperimentSnapshotDocument,
  ExperimentSnapshotModel,
} from "../models/ExperimentSnapshotModel";
import {
  MetricInterface,
  MetricStats,
  MetricAnalysis,
} from "../../types/metric";
import { SegmentInterface } from "../../types/segment";
import { ExperimentInterface } from "../../types/experiment";
import { PastExperiment } from "../../types/past-experiments";
import { FilterQuery } from "mongoose";
import { queueWebhook } from "../jobs/webhooks";
import { queueCDNInvalidate } from "../jobs/cacheInvalidate";
import { promiseAllChunks } from "../util/promise";
import { findDimensionById } from "../models/DimensionModel";
import {
  getReportVariations,
  reportArgsFromSnapshot,
  startExperimentAnalysis,
} from "./reports";
import { getValidDate } from "../util/dates";
import { getDataSourceById } from "../models/DataSourceModel";
import { SegmentModel } from "../models/SegmentModel";
import uniqBy from "lodash/uniqBy";
import { EXPERIMENT_REFRESH_FREQUENCY } from "../util/secrets";
import cronParser from "cron-parser";
import {
  ExperimentUpdateSchedule,
  OrganizationInterface,
} from "../../types/organization";

export const DEFAULT_METRIC_ANALYSIS_DAYS = 90;

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

export async function getExperimentsByMetric(
  orgId: string,
  metricId: string
): Promise<{ id: string; name: string }[]> {
  const experiments: { id: string; name: string }[] = [];

  const cols = {
    _id: false,
    id: true,
    name: true,
  };

  // Using as a goal metric
  const goals = await ExperimentModel.find(
    {
      organization: orgId,
      metrics: metricId,
    },
    cols
  );
  goals.forEach((exp) => {
    experiments.push({
      id: exp.id,
      name: exp.name,
    });
  });

  // Using as a guardrail metric
  const guardrails = await ExperimentModel.find(
    {
      organization: orgId,
      guardrails: metricId,
    },
    cols
  );
  guardrails.forEach((exp) => {
    experiments.push({
      id: exp.id,
      name: exp.name,
    });
  });

  // Using as an activation metric
  const activations = await ExperimentModel.find(
    {
      organization: orgId,
      activationMetric: metricId,
    },
    cols
  );
  activations.forEach((exp) => {
    experiments.push({
      id: exp.id,
      name: exp.name,
    });
  });

  return uniqBy(experiments, "id");
}

export async function removeMetricFromExperiments(
  metricId: string,
  orgId: string
) {
  // Remove from metrics
  await ExperimentModel.updateMany(
    { organization: orgId, metrics: metricId },
    { $pull: { metrics: metricId } }
  );

  // Remove from guardrails
  await ExperimentModel.updateMany(
    { organization: orgId, guardrails: metricId },
    { $pull: { guardrails: metricId } }
  );

  // Remove from activationMetric
  await ExperimentModel.updateMany(
    { organization: orgId, activationMetric: metricId },
    { $set: { activationMetric: "" } }
  );
}

export function deleteExperimentById(id: string) {
  return ExperimentModel.deleteOne({
    id,
  });
}

export async function getExperimentsUsingSegment(id: string, orgId: string) {
  return ExperimentModel.find(
    {
      organization: orgId,
      segment: id,
    },
    { id: 1, name: 1 }
  );
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

export async function getMetricAnalysis(
  metric: MetricInterface,
  queryData: QueryMap
): Promise<MetricAnalysis> {
  const metricData = (queryData.get("metric")?.result as MetricValueResult) || {
    users: 0,
    count: 0,
    mean: 0,
    stddev: 0,
  };

  let total = (metricData.count || 0) * (metricData.mean || 0);
  let count = metricData.count || 0;
  const dates: { d: Date; v: number; s: number; c: number }[] = [];

  // Calculate total from dates
  if (metricData.dates) {
    total = 0;
    count = 0;

    metricData.dates.forEach((d) => {
      const mean = d.mean;
      const stddev = d.stddev;

      const dateTotal = (d.count || 0) * (d.mean || 0);
      total += dateTotal;
      count += d.count || 0;
      dates.push({
        d: getValidDate(d.date),
        v: mean,
        c: d.count || 0,
        s: stddev,
      });
    });
  }

  const averageBase = count;
  const average = averageBase > 0 ? total / averageBase : 0;

  return {
    createdAt: new Date(),
    average,
    dates,
    segment: metric.segment || "",
  };
}

export async function refreshMetric(
  metric: MetricInterface,
  orgId: string,
  metricAnalysisDays: number = DEFAULT_METRIC_ANALYSIS_DAYS
) {
  if (metric.datasource) {
    const datasource = await getDataSourceById(
      metric.datasource,
      metric.organization
    );
    if (!datasource) {
      throw new Error("Could not load metric datasource");
    }
    const integration = getSourceIntegrationObject(datasource);

    let segment: SegmentInterface | undefined = undefined;
    if (metric.segment) {
      segment =
        (await SegmentModel.findOne({
          id: metric.segment,
          datasource: metric.datasource,
        })) || undefined;
      if (!segment) {
        throw new Error("Invalid user segment chosen");
      }
    }

    let days = metricAnalysisDays;
    if (days < 1 || days > 400) {
      days = DEFAULT_METRIC_ANALYSIS_DAYS;
    }

    const from = new Date();
    from.setDate(from.getDate() - days);
    const to = new Date();

    const baseParams: Omit<MetricValueParams, "metric"> = {
      from,
      to,
      name: `Last ${days} days`,
      includeByDate: true,
      segment,
    };

    const updates: Partial<MetricInterface> = {};

    updates.runStarted = new Date();
    updates.analysisError = "";

    const { queries, result } = await startRun(
      {
        metric: getMetricValue(integration, {
          ...baseParams,
          metric,
        }),
      },
      (queryData) => getMetricAnalysis(metric, queryData)
    );

    updates.queries = queries;
    if (result) {
      updates.analysis = result;
    }

    await updateMetric(metric.id, updates, orgId);
  } else {
    throw new Error("Cannot analyze manual metrics");
  }
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

export async function getSampleExperiment(
  organization: string
): Promise<ExperimentInterface | null> {
  const exp = await ExperimentModel.findOne({
    organization,
    id: /^exp_sample_/,
  });

  return exp ? exp.toJSON() : null;
}

export async function createExperiment(
  data: Partial<ExperimentInterface>,
  organization: OrganizationInterface
) {
  if (!data.organization) {
    throw new Error("Missing organization");
  }
  if (data.organization !== organization.id) {
    throw new Error("Experiment and Organization must match");
  }

  if (data.trackingKey) {
    // Make sure id is unique
    const existing = await getExperimentByTrackingKey(
      data.organization,
      data.trackingKey
    );
    if (existing) {
      throw new Error(
        "Error: Duplicate experiment id. Please choose something else"
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

  const nextUpdate = determineNextDate(
    organization.settings?.updateSchedule || null
  );

  const exp = await ExperimentModel.create({
    ...data,
    id: uniqid("exp_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    autoSnapshots: nextUpdate !== null,
    lastSnapshotAttempt: new Date(),
    nextSnapshotAttempt: nextUpdate,
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
          getReportVariations(experiment, phase),
          metric,
          rows,
          20
        );
        const data = res.dimensions[0];
        if (!data) return;
        data.variations.map((v, i) => {
          variations[i].metrics[m] = v;
        });
      };
    }),
    3
  );

  const srm = checkSrm(users, phase.variationWeights);

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

function determineNextDate(schedule: ExperimentUpdateSchedule | null) {
  // Default to every X hours if no organization-specific schedule is set
  let hours = EXPERIMENT_REFRESH_FREQUENCY;

  if (schedule?.type === "never") {
    return null;
  }
  if (schedule?.type === "cron") {
    try {
      const interval = cronParser.parseExpression(schedule?.cron || "");
      const next = interval.next();

      hours = (next.getTime() - Date.now()) / 1000 / 60 / 60;
    } catch (e) {
      console.error("Failed to parse cron expression: ", e);
    }
  }
  if (schedule?.type === "stale") {
    hours = schedule?.hours || 0;
  }

  // Sanity check to make sure the next update is somewhere between 1 hour and 7 days
  if (!hours) hours = EXPERIMENT_REFRESH_FREQUENCY;
  if (hours < 1) hours = 1;
  if (hours > 168) hours = 168;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function createSnapshot(
  experiment: ExperimentInterface,
  phaseIndex: number,
  organization: OrganizationInterface,
  dimensionId: string | null,
  useCache: boolean = false
) {
  const phase = experiment.phases[phaseIndex];
  if (!phase) {
    throw new Error("Invalid snapshot phase");
  }

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    runStarted: new Date(),
    error: "",
    dateCreated: new Date(),
    phase: phaseIndex,
    manual: false,
    queries: [],
    hasRawQueries: true,
    queryLanguage: "sql",
    dimension: dimensionId,
    results: undefined,
    unknownVariations: [],
    multipleExposures: 0,
    activationMetric: experiment.activationMetric || "",
    segment: experiment.segment || "",
    queryFilter: experiment.queryFilter || "",
    skipPartialData: experiment.skipPartialData || false,
  };

  const nextUpdate = determineNextDate(
    organization.settings?.updateSchedule || null
  );

  await ExperimentModel.updateOne(
    {
      id: experiment.id,
      organization: experiment.organization,
    },
    {
      $set: {
        lastSnapshotAttempt: new Date(),
        nextSnapshotAttempt: nextUpdate,
        autoSnapshots: nextUpdate !== null,
      },
    }
  );

  const { queries, results } = await startExperimentAnalysis(
    experiment.organization,
    reportArgsFromSnapshot(experiment, data),
    useCache
  );

  data.queries = queries;
  data.results = results?.dimensions;
  data.unknownVariations = results?.unknownVariations || [];
  data.multipleExposures = results?.multipleExposures || 0;

  const snapshot = await ExperimentSnapshotModel.create(data);

  return snapshot;
}

export async function ensureWatching(
  userId: string,
  orgId: string,
  item: string,
  type: "experiments" | "features"
) {
  await WatchModel.updateOne(
    {
      userId,
      organization: orgId,
    },
    {
      $addToSet: {
        [type]: item,
      },
    },
    {
      upsert: true,
    }
  );
}

export async function getExperimentWatchers(
  experimentId: string,
  orgId: string
) {
  const watchers = await WatchModel.find({
    experiments: experimentId,
    organization: orgId,
  });
  return watchers;
}

export async function processPastExperiments(
  data: QueryMap
): Promise<PastExperiment[]> {
  const experiments =
    (data.get("experiments")?.result as PastExperimentResult)?.experiments ||
    [];

  // Group by experiment and exposureQuery
  const experimentExposureMap = new Map<string, PastExperiment>();
  experiments.forEach((e) => {
    const key = e.experiment_id + "::" + e.exposureQueryId;
    let el = experimentExposureMap.get(key);
    if (!el) {
      el = {
        endDate: e.end_date,
        startDate: e.start_date,
        numVariations: 1,
        variationKeys: [e.variation_id],
        exposureQueryId: e.exposureQueryId || "",
        trackingKey: e.experiment_id,
        users: e.users,
        weights: [e.users],
      };
      experimentExposureMap.set(key, el);
    } else {
      if (e.start_date < el.startDate) {
        el.startDate = e.start_date;
      }
      if (e.end_date > el.endDate) {
        el.endDate = e.end_date;
      }
      if (!el.variationKeys.includes(e.variation_id)) {
        el.variationKeys.push(e.variation_id);
        el.weights.push(e.users);
        el.users += e.users;
        el.numVariations++;
      }
    }
  });

  // Group by experiment, choosing the exposure query with the most users
  const experimentMap = new Map<string, PastExperiment>();
  experimentExposureMap.forEach((exp) => {
    const key = exp.trackingKey;
    const el = experimentMap.get(key);
    if (!el || el.users < exp.users) {
      experimentMap.set(key, exp);
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

export async function experimentUpdated(
  experiment: ExperimentInterface,
  previousProject: string = ""
) {
  // fire the webhook:
  await queueWebhook(
    experiment.organization,
    ["dev", "production"],
    [previousProject || "", experiment.project || ""],
    false
  );

  // invalidate the CDN
  await queueCDNInvalidate(experiment.organization, (key) => {
    // Which url to invalidate depends on the type of experiment
    return experiment.implementation === "visual"
      ? `/js/${key}.js`
      : `/config/${key}`;
  });
}
