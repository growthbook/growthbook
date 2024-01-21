import mongoose from "mongoose";
import { ExperimentMetricInterface } from "shared/experiments";
import { LegacyMetricInterface, MetricInterface } from "../../types/metric";
import { getConfigMetrics, usingFileConfig } from "../init/config";
import { upgradeMetricDoc } from "../util/migrations";
import { OrganizationInterface } from "../../types/organization";
import { EventAuditUser } from "../events/event-types";
import { ALLOW_CREATE_METRICS } from "../util/secrets";
import { queriesSchema } from "./QueryModel";
import { ImpactEstimateModel } from "./ImpactEstimateModel";
import { removeMetricFromExperiments } from "./ExperimentModel";
import { addTagsDiff } from "./TagModel";
import { getAllFactMetricsForOrganization } from "./FactMetricModel";

export const ALLOWED_METRIC_TYPES = [
  "binomial",
  "count",
  "duration",
  "revenue",
];

const metricSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  managedBy: String,
  owner: String,
  datasource: String,
  name: String,
  description: String,
  type: { type: String },
  table: { type: String },
  column: String,
  earlyStart: Boolean,
  inverse: Boolean,
  ignoreNulls: Boolean,
  capping: String,
  capValue: Number,
  denominator: String,
  conversionWindowHours: Number,
  conversionDelayHours: Number,
  winRisk: Number,
  loseRisk: Number,
  maxPercentChange: Number,
  minPercentChange: Number,
  minSampleSize: Number,
  regressionAdjustmentOverride: Boolean,
  regressionAdjustmentEnabled: Boolean,
  regressionAdjustmentDays: Number,
  dateCreated: Date,
  dateUpdated: Date,
  segment: String,
  userIdTypes: [String],
  userIdColumns: {},
  status: String,
  sql: String,
  templateVariables: {
    eventName: String,
    valueColumn: String,
  },
  aggregation: String,
  timestampColumn: String,
  queryFormat: String,
  tags: [String],
  projects: {
    type: [String],
    index: true,
  },
  conditions: [
    {
      _id: false,
      column: String,
      operator: String,
      value: String,
    },
  ],
  queries: queriesSchema,
  runStarted: Date,
  analysisError: String,
  analysis: {
    createdAt: Date,
    segment: String,
    average: Number,
    stddev: Number,
    count: Number,
    histogram: [
      {
        _id: false,
        b: String,
        c: Number,
      },
    ],
    dates: [
      {
        _id: false,
        d: Date,
        v: Number,
        s: Number,
        c: Number,
      },
    ],
  },
});
metricSchema.index({ id: 1, organization: 1 }, { unique: true });
type MetricDocument = mongoose.Document & LegacyMetricInterface;

const MetricModel = mongoose.model<LegacyMetricInterface>(
  "Metric",
  metricSchema
);

function toInterface(doc: MetricDocument): MetricInterface {
  return upgradeMetricDoc(doc.toJSON());
}

export async function insertMetric(metric: Partial<MetricInterface>) {
  if (usingFileConfig() && !ALLOW_CREATE_METRICS) {
    throw new Error("Cannot add new metrics. Metrics managed by config.yml");
  }
  return toInterface(await MetricModel.create(metric));
}

export async function insertMetrics(
  metrics: Pick<
    MetricInterface,
    | "name"
    | "type"
    | "sql"
    | "id"
    | "organization"
    | "datasource"
    | "dateCreated"
    | "dateUpdated"
  >[]
) {
  if (usingFileConfig() && !ALLOW_CREATE_METRICS) {
    throw new Error("Cannot add metrics. Metrics managed by config.yml");
  }
  return (await MetricModel.insertMany(metrics)).map(toInterface);
}

export async function deleteMetricById(
  metric: MetricInterface,
  org: OrganizationInterface,
  user: EventAuditUser
) {
  if (metric.managedBy === "config") {
    throw new Error("Cannot delete a metric managed by config.yml");
  }
  if (metric.managedBy === "api" && user?.type !== "api_key") {
    throw new Error("Cannot delete a metric managed by the API");
  }

  // delete references:
  // ideas (impact estimate)
  await ImpactEstimateModel.updateMany(
    {
      metric: metric.id,
      organization: org.id,
    },
    { metric: "" }
  );

  // Experiments
  await removeMetricFromExperiments(metric.id, org, user);

  await MetricModel.deleteOne({
    id: metric.id,
    organization: org.id,
  });
}

/**
 * Deletes metrics where the provided project is the only project for that metric
 * @param projectId
 * @param organization
 * @param user
 */
export async function deleteAllMetricsForAProject({
  projectId,
  organization,
  user,
}: {
  projectId: string;
  organization: OrganizationInterface;
  user: EventAuditUser;
}) {
  const metricsToDelete = await MetricModel.find({
    organization: organization.id,
    projects: [projectId],
  });

  for (const metric of metricsToDelete) {
    await deleteMetricById(metric, organization, user);
  }
}

export async function getMetricMap(organization: string) {
  const metricMap = new Map<string, ExperimentMetricInterface>();
  const allMetrics = await getMetricsByOrganization(organization);
  allMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const allFactMetrics = await getAllFactMetricsForOrganization(organization);
  allFactMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  return metricMap;
}

export async function getMetricsByOrganization(organization: string) {
  const metrics: MetricInterface[] = [];

  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    getConfigMetrics(organization).forEach((m) => {
      metrics.push(m);
    });
  }

  const docs = await MetricModel.find({
    organization,
  });

  docs.forEach((doc) => {
    if (metrics.some((m) => m.id === doc.id)) {
      return;
    }
    metrics.push(toInterface(doc));
  });

  return metrics;
}

export async function getMetricsByDatasource(
  datasource: string,
  organization: string
) {
  const metrics: MetricInterface[] = [];

  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    getConfigMetrics(organization)
      .filter((m) => m.datasource === datasource)
      .forEach((m) => {
        metrics.push(m);
      });
  }

  const docs = await MetricModel.find({
    datasource,
    organization,
  });

  docs.forEach((doc) => {
    if (metrics.some((m) => m.id === doc.id)) {
      return;
    }
    metrics.push(toInterface(doc));
  });

  return metrics;
}

export async function getSampleMetrics(organization: string) {
  const docs = await MetricModel.find({
    id: /^met_sample/,
    organization,
  });
  return docs.map(toInterface);
}

export async function getMetricById(
  id: string,
  organization: string,
  includeAnalysis: boolean = false
) {
  // If using config.yml, immediately return the from there if found
  if (usingFileConfig()) {
    const doc =
      getConfigMetrics(organization).filter((m) => m.id === id)[0] || null;
    if (doc) {
      if (includeAnalysis) {
        const metric = await MetricModel.findOne({ id, organization });
        doc.queries = metric?.queries || [];
        doc.analysis = metric?.analysis || undefined;
        doc.analysisError = metric?.analysisError || undefined;
        doc.runStarted = metric?.runStarted || null;
      }

      return doc;
    }
  }

  const res = await MetricModel.findOne({
    id,
    organization,
  });

  return res ? toInterface(res) : null;
}

export async function getMetricsByIds(ids: string[], organization: string) {
  const metrics: MetricInterface[] = [];

  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    getConfigMetrics(organization)
      .filter((m) => ids.includes(m.id))
      .forEach((m) => {
        metrics.push(m);
      });
  }

  const remainingIds = ids.filter((id) => !metrics.some((m) => m.id === id));

  if (remainingIds.length > 0) {
    const docs = await MetricModel.find({
      id: { $in: remainingIds },
      organization,
    });
    docs.forEach((doc) => {
      metrics.push(toInterface(doc));
    });
  }
  return metrics;
}

export async function findRunningMetricsByQueryId(
  orgIds: string[],
  queryIds: string[]
) {
  const docs = await MetricModel.find({
    // Query ids are globally unique, this filter is just for index performance
    organization: { $in: orgIds },
    queries: {
      $elemMatch: { query: { $in: queryIds }, status: "running" },
    },
  });

  // TODO: some of these might be from config.yml and the docs will be missing fields
  return docs.map((doc) => toInterface(doc));
}

export async function removeProjectFromMetrics(
  project: string,
  organization: string
) {
  await MetricModel.updateMany(
    { organization, projects: project },
    {
      $pull: { projects: project },
      $set: { dateUpdated: new Date() },
    }
  );
}

export async function getMetricsUsingSegment(
  segment: string,
  organization: string
) {
  const metrics: MetricInterface[] = [];

  // If using config.yml, start with those
  if (usingFileConfig()) {
    getConfigMetrics(organization)
      .filter((m) => m.segment === segment)
      .forEach((m) => {
        metrics.push(m);
      });
  }

  const docs = await MetricModel.find({
    organization,
    segment,
  });
  docs.forEach((doc) => {
    if (metrics.some((m) => m.id === doc.id)) {
      return;
    }
    metrics.push(toInterface(doc));
  });

  return metrics;
}

const FILE_CONFIG_UPDATEABLE_FIELDS: (keyof MetricInterface)[] = [
  "analysis",
  "analysisError",
  "queries",
  "runStarted",
];

const FIELDS_NOT_REQUIRING_DATE_UPDATED: (keyof MetricInterface)[] = [
  "analysis",
  "analysisError",
  "queries",
  "runStarted",
];

function addDateUpdatedToUpdates(
  updates: Partial<MetricInterface>
): Partial<MetricInterface> {
  // If any field requires dateUpdated to be set
  if (
    Object.keys(updates).some(
      (k: keyof MetricInterface) =>
        !FIELDS_NOT_REQUIRING_DATE_UPDATED.includes(k)
    )
  ) {
    return { ...updates, dateUpdated: new Date() };
  }

  // Otherwise, just return the original updates
  return updates;
}

export async function updateMetric(
  metric: MetricInterface,
  updates: Partial<MetricInterface>,
  organization: string,
  user: EventAuditUser
) {
  updates = addDateUpdatedToUpdates(updates);

  const safeUpdates = Object.keys(updates).every((k: keyof MetricInterface) =>
    FILE_CONFIG_UPDATEABLE_FIELDS.includes(k)
  );
  if (!safeUpdates) {
    if (metric.managedBy === "config") {
      throw new Error("Cannot update. Metric managed by config.yml");
    }
    if (metric.managedBy === "api" && user?.type !== "api_key") {
      throw new Error("Cannot update. Metric managed by the API");
    }
  }

  // If using config.yml, need to do an `upsert` since it might not exist in mongo yet
  if (metric.managedBy === "config") {
    await MetricModel.updateOne(
      { id: metric.id, organization },
      {
        $set: updates,
      },
      { upsert: true }
    );
  } else {
    await MetricModel.updateOne(
      {
        id: metric.id,
        organization,
      },
      {
        $set: updates,
      }
    );
  }

  await addTagsDiff(organization, metric.tags || [], updates.tags || []);
}

export async function removeSegmentFromAllMetrics(
  organization: string,
  segment: string
) {
  const updates = addDateUpdatedToUpdates({ segment: "" });
  await MetricModel.updateMany(
    { organization, segment },
    {
      $set: updates,
    }
  );
}

export async function removeTagInMetrics(organization: string, tag: string) {
  await MetricModel.updateMany(
    { organization, tags: tag },
    {
      $set: { dateUpdated: new Date() },
      $pull: { tags: tag },
    }
  );
}
