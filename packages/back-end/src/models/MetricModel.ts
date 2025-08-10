import mongoose from "mongoose";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  InsertMetricProps,
  LegacyMetricInterface,
  MetricInterface,
} from "back-end/types/metric";
import { getConfigMetrics, usingFileConfig } from "back-end/src/init/config";
import { upgradeMetricDoc } from "back-end/src/util/migrations";
import { ALLOW_CREATE_METRICS } from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { generateEmbeddings } from "back-end/src/enterprise/services/providerAI";
import { queriesSchema } from "./QueryModel";
import { ImpactEstimateModel } from "./ImpactEstimateModel";
import { removeMetricFromExperiments } from "./ExperimentModel";
import { addTagsDiff } from "./TagModel";

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
  cappingSettings: {
    type: { type: String },
    value: Number,
    ignoreZeros: Boolean,
  },
  windowSettings: {
    type: { type: String },
    windowValue: Number,
    windowUnit: String,
    delayValue: Number,
    delayUnit: String,
  },
  priorSettings: {
    override: Boolean,
    proper: Boolean,
    mean: Number,
    stddev: Number,
  },
  denominator: String,
  winRisk: Number,
  loseRisk: Number,
  maxPercentChange: Number,
  minPercentChange: Number,
  minSampleSize: Number,
  targetMDE: Number,
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

    // deprecated fields
    capping: String,
    capValue: Number,
    conversionWindowHours: Number,
    conversionDelayHours: Number,
  },
});

metricSchema.index({ id: 1, organization: 1 }, { unique: true });

const MetricModel = mongoose.model<LegacyMetricInterface>(
  "Metric",
  metricSchema,
);
const COLLECTION = "metrics";

const toInterface: ToInterface<MetricInterface> = (doc) => {
  return upgradeMetricDoc(removeMongooseFields(doc));
};

export async function insertMetric(
  context: ReqContext | ApiReqContext,
  metric: Partial<MetricInterface>,
) {
  if (usingFileConfig() && !ALLOW_CREATE_METRICS) {
    throw new Error("Cannot add new metrics. Metrics managed by config.yml");
  }

  if (metric.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error(
      "Cannot mark a metric as managed by the API outside of the API.",
    );
  }

  if (metric.managedBy === "admin") {
    throw new Error(
      "We have deprecated support for marking Legacy Metrics as Official via the UI. We suggest using Fact Metrics instead.",
    );
  }

  if (!context.permissions.canCreateMetric(metric)) {
    context.permissions.throwPermissionError();
  }

  return toInterface(await MetricModel.create(metric));
}

export async function insertMetrics(
  context: ReqContext | ApiReqContext,
  metrics: InsertMetricProps[],
) {
  if (usingFileConfig() && !ALLOW_CREATE_METRICS) {
    throw new Error("Cannot add metrics. Metrics managed by config.yml");
  }
  for (const metric of metrics) {
    if (metric.managedBy === "api" && context.auditUser?.type !== "api_key") {
      throw new Error(
        "Cannot mark a metric as managed by the API outside of the API.",
      );
    }
    if (metric.managedBy === "admin") {
      throw new Error(
        "We have deprecated support for marking Legacy Metrics as Official via the UI. We suggest using Fact Metrics instead.",
      );
    }
    if (!context.permissions.canCreateMetric(metric)) {
      context.permissions.throwPermissionError();
    }
  }
  return (await MetricModel.insertMany(metrics)).map(toInterface);
}

export async function deleteMetricById(
  context: ReqContext | ApiReqContext,
  metric: LegacyMetricInterface | MetricInterface,
) {
  if (metric.managedBy === "config") {
    throw new Error("Cannot delete a metric managed by config.yml");
  }
  if (metric.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error("Cannot delete a metric managed by the API");
  }
  if (!context.permissions.canDeleteMetric(metric)) {
    context.permissions.throwPermissionError();
  }

  // delete references:
  // ideas (impact estimate)
  await ImpactEstimateModel.updateMany(
    {
      metric: metric.id,
      organization: context.org.id,
    },
    { metric: "" },
  );

  // Experiments
  await removeMetricFromExperiments(context, metric.id);

  await MetricModel.deleteOne({
    id: metric.id,
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
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
}) {
  const metricsToDelete = await getCollection(COLLECTION)
    .find({
      organization: context.org.id,
      projects: [projectId],
    })
    .toArray();

  for (const metric of metricsToDelete) {
    await deleteMetricById(context, toInterface(metric));
  }
}

export async function getMetricMap(
  context: ReqContext | ApiReqContext,
): Promise<Map<string, ExperimentMetricInterface>> {
  const metricMap = new Map<string, ExperimentMetricInterface>();
  const allMetrics = await getMetricsByOrganization(context);
  allMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const allFactMetrics = await context.models.factMetrics.getAll();
  allFactMetrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  return metricMap;
}

async function findMetrics(
  context: ReqContext | ApiReqContext,
  additionalQuery?: Partial<MetricInterface>,
) {
  const metrics: MetricInterface[] = [];
  const metricIds = new Set<string>();

  // If using config.yml, first check there
  if (usingFileConfig()) {
    const filter = additionalQuery
      ? (m: MetricInterface) => {
          for (const key in additionalQuery) {
            if (
              m[key as keyof MetricInterface] !==
              additionalQuery[key as keyof MetricInterface]
            ) {
              return false;
            }
          }
          return true;
        }
      : false;
    getConfigMetrics(context)
      .filter((m) => !filter || filter(m))
      .forEach((m) => {
        metrics.push(m);
        metricIds.add(m.id);
      });

    // If metrics are locked down to just a config file, return immediately
    if (!ALLOW_CREATE_METRICS) {
      return metrics;
    }
  }

  const docs = await getCollection(COLLECTION)
    .find(
      {
        ...additionalQuery,
        organization: context.org.id,
      },
      {
        // This is never needed when finding multiple metrics
        // This field can get quite large, so it's best to exclude it
        projection: { analysis: 0 },
      },
    )
    .toArray();
  docs.forEach((doc) => {
    if (metricIds.has(doc.id)) {
      return;
    }
    metrics.push(toInterface(doc));
    metricIds.add(doc.id);
  });

  return metrics.filter((m) =>
    context.permissions.canReadMultiProjectResource(m.projects),
  );
}

export async function getMetricsByOrganization(
  context: ReqContext | ApiReqContext,
) {
  return findMetrics(context);
}

export async function getMetricsByDatasource(
  context: ReqContext | ApiReqContext,
  datasource: string,
) {
  return findMetrics(context, { datasource });
}

export async function getSampleMetrics(context: ReqContext | ApiReqContext) {
  const docs = await getCollection(COLLECTION)
    .find({
      id: /^met_sample/,
      organization: context.org.id,
    })
    .toArray();
  return docs
    .map(toInterface)
    .filter((m) => context.permissions.canReadMultiProjectResource(m.projects));
}

export async function getMetricById(
  context: ReqContext | ApiReqContext,
  id: string,
  includeAnalysis: boolean = false,
) {
  // If using config.yml, immediately return the from there if found
  if (usingFileConfig()) {
    const doc = getConfigMetrics(context).filter((m) => m.id === id)[0] || null;
    if (doc) {
      if (includeAnalysis) {
        const metric = await getCollection(COLLECTION).findOne({
          id,
          organization: context.org.id,
        });
        doc.queries = metric?.queries || [];
        doc.analysis = metric?.analysis || undefined;
        doc.analysisError = metric?.analysisError || undefined;
        doc.runStarted = metric?.runStarted || null;
      }
      return doc;
    }
    // If metrics are locked down to just a config file, return immediately
    if (!ALLOW_CREATE_METRICS) {
      return null;
    }
  }

  const res = await getCollection(COLLECTION).findOne({
    id,
    organization: context.org.id,
  });

  const metric = res ? toInterface(res) : null;

  if (
    !metric ||
    !context.permissions.canReadMultiProjectResource(metric.projects)
  ) {
    return null;
  }
  return metric;
}

export async function getMetricsByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<MetricInterface[]> {
  const metrics: MetricInterface[] = [];

  if (!ids.length) {
    return metrics;
  }

  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    getConfigMetrics(context)
      .filter((m) => ids.includes(m.id))
      .forEach((m) => {
        metrics.push(m);
      });
    // If metrics are locked down to just a config file, return immediately
    if (!ALLOW_CREATE_METRICS) {
      return metrics;
    }
  }

  const remainingIds = ids.filter((id) => !metrics.some((m) => m.id === id));

  if (remainingIds.length > 0) {
    const docs = await getCollection(COLLECTION)
      .find({
        id: { $in: remainingIds },
        organization: context.org.id,
      })
      .toArray();
    docs.forEach((doc) => {
      metrics.push(toInterface(doc));
    });
  }
  return metrics.filter((m) =>
    context.permissions.canReadMultiProjectResource(m.projects),
  );
}

export async function findRunningMetricsByQueryId(
  orgIds: string[],
  queryIds: string[],
) {
  const docs = await getCollection(COLLECTION)
    .find({
      // Query ids are globally unique, this filter is just for index performance
      organization: { $in: orgIds },
      queries: {
        $elemMatch: { query: { $in: queryIds }, status: "running" },
      },
    })
    .toArray();

  // TODO: some of these might be from config.yml and the docs will be missing fields
  return docs.map((doc) => toInterface(doc));
}

export async function removeProjectFromMetrics(
  project: string,
  organization: string,
) {
  await MetricModel.updateMany(
    { organization, projects: project },
    {
      $pull: { projects: project },
      $set: { dateUpdated: new Date() },
    },
  );
}

export async function getMetricsUsingSegment(
  context: ReqContext | ApiReqContext,
  segment: string,
) {
  return findMetrics(context, { segment });
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
  updates: Partial<MetricInterface>,
): Partial<MetricInterface> {
  // If any field requires dateUpdated to be set
  if (
    Object.keys(updates).some(
      (k: keyof MetricInterface) =>
        !FIELDS_NOT_REQUIRING_DATE_UPDATED.includes(k),
    )
  ) {
    return { ...updates, dateUpdated: new Date() };
  }

  // Otherwise, just return the original updates
  return updates;
}

export async function updateMetricQueriesAndStatus(
  metric: MetricInterface,
  updates: Partial<Pick<MetricInterface, "queries" | "analysisError">>,
) {
  await MetricModel.updateOne(
    {
      id: metric.id,
      organization: metric.organization,
    },
    {
      $set: updates,
    },
  );
}

export async function updateMetric(
  context: ReqContext | ApiReqContext,
  metric: MetricInterface,
  updates: Partial<MetricInterface>,
) {
  updates = addDateUpdatedToUpdates(updates);

  const safeUpdates = Object.keys(updates).every((k: keyof MetricInterface) =>
    FILE_CONFIG_UPDATEABLE_FIELDS.includes(k),
  );
  if (!safeUpdates) {
    if (metric.managedBy === "config") {
      throw new Error("Cannot update. Metric managed by config.yml");
    }
    if (metric.managedBy === "api" && context.auditUser?.type !== "api_key") {
      throw new Error("Cannot update. Metric managed by the API");
    }
    if (!context.permissions.canUpdateMetric(metric, updates)) {
      context.permissions.throwPermissionError();
    }
  }

  // If using config.yml, need to do an `upsert` since it might not exist in mongo yet
  if (metric.managedBy === "config") {
    await MetricModel.updateOne(
      { id: metric.id, organization: context.org.id },
      {
        $set: updates,
      },
      { upsert: true },
    );
  } else {
    await MetricModel.updateOne(
      {
        id: metric.id,
        organization: context.org.id,
      },
      {
        $set: updates,
      },
    );
  }

  await addTagsDiff(context.org.id, metric.tags || [], updates.tags || []);
}

export async function removeSegmentFromAllMetrics(
  organization: string,
  segment: string,
) {
  const updates = addDateUpdatedToUpdates({ segment: "" });
  await MetricModel.updateMany(
    { organization, segment },
    {
      $set: updates,
    },
  );
}

export async function removeTagInMetrics(organization: string, tag: string) {
  await MetricModel.updateMany(
    { organization, tags: tag },
    {
      $set: { dateUpdated: new Date() },
      $pull: { tags: tag },
    },
  );
}

export async function generateMetricEmbeddings(
  context: ReqContext | ApiReqContext,
  metricsToGenerateEmbeddings: MetricInterface[],
) {
  const batchSize = 15;
  for (let i = 0; i < metricsToGenerateEmbeddings.length; i += batchSize) {
    const batch = metricsToGenerateEmbeddings.slice(i, i + batchSize);
    const input = batch.map((m) => getTextForEmbedding(m));
    const embeddings = await generateEmbeddings({
      context,
      input,
    });

    for (let j = 0; j < batch.length; j++) {
      const m = batch[j];
      // save the embeddings back to the experiment:
      try {
        await context.models.vectors.addOrUpdateMetricVector(m.id, {
          embeddings: embeddings[j].embedding,
        });
      } catch (error) {
        throw new Error("Error updating embeddings");
      }
    }
  }
}
const getTextForEmbedding = (metric: MetricInterface): string => {
  return `Name: ${metric.name}\nDescription: ${metric.description}`;
};
