import mongoose, { FilterQuery } from "mongoose";
import { ExperimentMetricInterface } from "shared/experiments";
import { hasReadAccess } from "shared/permissions";
import { LegacyMetricInterface, MetricInterface } from "../../types/metric";
import { getConfigMetrics, usingFileConfig } from "../init/config";
import { upgradeMetricDoc } from "../util/migrations";
import { EventAuditUser } from "../events/event-types";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";
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
  if (usingFileConfig()) {
    throw new Error("Cannot add. Metrics managed by config.yml");
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
  if (usingFileConfig()) {
    throw new Error("Cannot add. Metrics managed by config.yml");
  }
  return (await MetricModel.insertMany(metrics)).map(toInterface);
}

export async function deleteMetricById(
  id: string,
  context: ReqContext | ApiReqContext,
  user: EventAuditUser
) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Metrics managed by config.yml");
  }

  // delete references:
  // ideas (impact estimate)
  await ImpactEstimateModel.updateMany(
    {
      metric: id,
      organization: context.org.id,
    },
    { metric: "" }
  );

  // Experiments
  await removeMetricFromExperiments(id, context, user);

  await MetricModel.deleteOne({
    id,
    organization: context.org.id,
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
  context,
  user,
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
  user: EventAuditUser;
}) {
  const metricsToDelete = await MetricModel.find({
    organization: context.org.id,
    projects: [projectId],
  });

  for (const metric of metricsToDelete) {
    await deleteMetricById(metric.id, context, user);
  }
}

export async function getMetricMap(context: ReqContext | ApiReqContext) {
  const metricMap = new Map<string, ExperimentMetricInterface>();
  const allMetrics = await getMetricsByOrganization(context);
  allMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const allFactMetrics = await getAllFactMetricsForOrganization(context);
  allFactMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  return metricMap;
}

export async function getMetricsByOrganization(
  context: ReqContext | ApiReqContext
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigMetrics(context.org.id);
  }

  const docs = await MetricModel.find({
    organization: context.org.id,
  });

  const metrics = docs.map(toInterface);

  return metrics.filter((m) =>
    hasReadAccess(context.readAccessFilter, m.projects)
  );
}

export async function getMetricsByDatasource(
  datasource: string,
  context: ReqContext | ApiReqContext
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigMetrics(context.org.id).filter(
      (m) => m.datasource === datasource
    );
  }

  const docs = await MetricModel.find({
    datasource,
    organization: context.org.id,
  });

  const metrics = docs.map(toInterface);
  return metrics.filter((metric) =>
    hasReadAccess(context.readAccessFilter, metric.projects)
  );
}

export async function getSampleMetrics(organization: string) {
  if (usingFileConfig()) return [];

  const docs = await MetricModel.find({
    id: /^met_sample/,
    organization,
  });
  return docs.map(toInterface);
}

export async function getMetricById(
  id: string,
  context: ReqContext | ApiReqContext,
  includeAnalysis: boolean = false
) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    const doc =
      getConfigMetrics(context.org.id).filter((m) => m.id === id)[0] || null;
    if (!doc) return null;

    if (includeAnalysis) {
      const metric = await MetricModel.findOne({ id, context });
      doc.queries = metric?.queries || [];
      doc.analysis = metric?.analysis || undefined;
      doc.analysisError = metric?.analysisError || undefined;
      doc.runStarted = metric?.runStarted || null;
    }

    return doc;
  }

  const res = await MetricModel.findOne({
    id,
    organization: context.org.id,
  });

  if (!res) return null;

  const metric = toInterface(res);

  return hasReadAccess(context.readAccessFilter, metric.projects)
    ? metric
    : null;
}

//TODO: I think we can remove this function - it's not being called anywhere
export async function getMetricsByIds(
  ids: string[],
  context: ReqContext | ApiReqContext
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigMetrics(context.org.id).filter(
      (m) => ids.includes(m.id) || []
    );
  }

  const docs = await MetricModel.find({
    id: { $in: ids },
    organization: context.org.id,
  });

  const metrics = docs.map(toInterface);

  return metrics.filter((metric) =>
    hasReadAccess(context.readAccessFilter, metric.projects)
  );
}

//TODO: Pickup here
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
  context: ReqContext | ApiReqContext
) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    return (
      getConfigMetrics(context.org.id).filter((m) => m.segment === segment) ||
      []
    );
  }

  const docs = await MetricModel.find({
    organization: context.org.id,
    segment,
  });

  const metrics = docs.map(toInterface);

  return metrics.filter((metric) =>
    hasReadAccess(context.readAccessFilter, metric.projects)
  );
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
  id: string,
  updates: Partial<MetricInterface>,
  context: ReqContext | ApiReqContext
) {
  updates = addDateUpdatedToUpdates(updates);

  if (usingFileConfig()) {
    // Trying to update unsupported properties
    if (
      Object.keys(updates).filter(
        (k: keyof MetricInterface) => !FILE_CONFIG_UPDATEABLE_FIELDS.includes(k)
      ).length > 0
    ) {
      throw new Error("Cannot update. Metrics managed by config.yml");
    }

    //TODO: Should we move the getMetricById call above this update?
    await MetricModel.updateOne(
      { id, organization: context.org.id },
      {
        $set: updates,
      },
      { upsert: true }
    );
    return;
  }

  const metric = await getMetricById(id, context);
  if (!metric) {
    throw new Error("Could not find metric");
  }

  await MetricModel.updateOne(
    {
      id,
      organization: context.org.id,
    },
    {
      $set: updates,
    }
  );

  await addTagsDiff(context.org.id, metric.tags || [], updates.tags || []);
}

export async function updateMetricsByQuery(
  query: FilterQuery<MetricDocument>,
  updates: Partial<MetricInterface>
) {
  updates = addDateUpdatedToUpdates(updates);

  if (usingFileConfig()) {
    // Trying to update unsupported properties
    if (
      Object.keys(updates).filter(
        (k: keyof MetricInterface) => !FILE_CONFIG_UPDATEABLE_FIELDS.includes(k)
      ).length > 0
    ) {
      throw new Error("Cannot update. Metrics managed by config.yml");
    }

    await MetricModel.updateMany(
      query,
      {
        $set: updates,
      },
      {
        upsert: true,
      }
    );
    return;
  }

  await MetricModel.updateMany(query, {
    $set: updates,
  });
}

export async function removeTagInMetrics(organization: string, tag: string) {
  if (usingFileConfig()) {
    return;
  }
  const query = { organization, tags: tag };
  await MetricModel.updateMany(query, {
    $set: { dateUpdated: new Date() },
    $pull: { tags: tag },
  });
  return;
}
