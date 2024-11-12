import { each, isEqual, pick, uniqWith } from "lodash";
import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import cloneDeep from "lodash/cloneDeep";
import { includeExperimentInPayload, hasVisualChanges } from "shared/util";
import { generateTrackingKey } from "shared/experiments";
import { v4 as uuidv4 } from "uuid";
import {
  Changeset,
  ExperimentInterface,
  ExperimentType,
  LegacyExperimentInterface,
  Variation,
} from "back-end/types/experiment";
import { ReqContext } from "back-end/types/organization";
import { VisualChange } from "back-end/types/visual-changeset";
import {
  determineNextDate,
  toExperimentApiInterface,
} from "back-end/src/services/experiments";
import { logger } from "back-end/src/util/logger";
import { upgradeExperimentDoc } from "back-end/src/util/migrations";
import {
  refreshSDKPayloadCache,
  URLRedirectExperiment,
  VisualExperiment,
} from "back-end/src/services/features";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { FeatureInterface } from "back-end/types/feature";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { ApiReqContext } from "back-end/types/api";
import {
  getCollection,
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { IdeaDocument } from "./IdeasModel";
import { addTags } from "./TagModel";
import { createEvent } from "./EventModel";
import {
  findVisualChangesets,
  VisualChangesetModel,
} from "./VisualChangesetModel";
import { getFeaturesByIds } from "./FeatureModel";

const COLLECTION = "experiments";

type FindOrganizationOptions = {
  experimentId: string;
  context: ReqContext | ApiReqContext;
};

type FilterKeys = ExperimentInterface & { _id: string };

type SortFilter = {
  [key in keyof Partial<FilterKeys>]: 1 | -1;
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

const experimentSchema = new mongoose.Schema({
  id: String,
  trackingKey: String,
  organization: {
    type: String,
    index: true,
  },
  project: String,
  owner: String,
  datasource: String,
  userIdType: String,
  exposureQueryId: String,
  hashAttribute: String,
  fallbackAttribute: String,
  hashVersion: Number,
  disableStickyBucketing: Boolean,
  bucketVersion: Number,
  minBucketVersion: Number,
  name: String,
  dateCreated: Date,
  dateUpdated: Date,
  tags: [String],
  description: String,
  // Observations is not used anymore, keeping here so it will continue being saved in Mongo if present
  observations: String,
  hypothesis: String,
  pastNotifications: [String],
  metricOverrides: [
    {
      _id: false,
      id: String,
      windowType: String,
      windowHours: Number,
      delayHours: Number,
      winRisk: Number,
      loseRisk: Number,
      properPriorOverride: Boolean,
      properPriorEnabled: Boolean,
      properPriorMean: Number,
      properPriorStdDev: Number,
      regressionAdjustmentOverride: Boolean,
      regressionAdjustmentEnabled: Boolean,
      regressionAdjustmentDays: Number,
      // deprecated fields
      conversionWindowHours: Number,
      conversionDelayHours: Number,
    },
  ],
  // These are using {} instead of [String] so Mongoose doesn't prefill them with empty arrays
  // This is necessary for migrations to work properly
  metrics: {},
  guardrails: {},
  goalMetrics: {},
  secondaryMetrics: {},
  guardrailMetrics: {},
  activationMetric: String,
  segment: String,
  queryFilter: String,
  skipPartialData: Boolean,
  attributionModel: String,
  archived: Boolean,
  status: String,
  results: String,
  analysis: String,
  winner: Number,
  releasedVariationId: String,
  excludeFromPayload: Boolean,
  currentPhase: Number,
  autoAssign: Boolean,
  // Legacy field, no longer used when creating experiments
  implementation: String,
  previewURL: String,
  targetURLRegex: String,
  variations: [
    {
      _id: false,
      id: String,
      name: String,
      description: String,
      key: String,
      value: String,
      screenshots: [
        {
          _id: false,
          path: String,
          width: Number,
          height: Number,
          description: String,
        },
      ],
      css: String,
      dom: [
        {
          _id: false,
          selector: String,
          action: String,
          attribute: String,
          value: String,
        },
      ],
    },
  ],
  phases: [
    {
      _id: false,
      dateStarted: Date,
      dateEnded: Date,
      phase: String,
      name: String,
      reason: String,
      coverage: Number,
      condition: String,
      savedGroups: [
        {
          _id: false,
          ids: [String],
          match: String,
        },
      ],
      prerequisites: [
        {
          _id: false,
          id: String,
          condition: String,
        },
      ],
      namespace: {},
      seed: String,
      variationWeights: [Number],
      groups: [String],
      banditEvents: [
        {
          _id: false,
          date: Date,
          banditResult: banditResultObject,
          snapshotId: String,
        },
      ],
    },
  ],
  data: String,
  lastSnapshotAttempt: Date,
  nextSnapshotAttempt: Date,
  autoSnapshots: Boolean,
  ideaSource: String,
  regressionAdjustmentEnabled: Boolean,
  hasVisualChangesets: Boolean,
  hasURLRedirects: Boolean,
  linkedFeatures: [String],
  sequentialTestingEnabled: Boolean,
  sequentialTestingTuningParameter: Number,
  statsEngine: String,
  manualLaunchChecklist: [
    {
      key: String,
      status: {
        type: String,
        enum: ["complete", "incomplete"],
      },
    },
  ],
  type: String,
  banditStage: String,
  banditStageDateStarted: Date,
  banditScheduleValue: Number,
  banditScheduleUnit: String,
  banditBurnInValue: Number,
  banditBurnInUnit: String,
});

type ExperimentDocument = mongoose.Document & ExperimentInterface;

export const ExperimentModel = mongoose.model<ExperimentInterface>(
  "Experiment",
  experimentSchema
);

/**
 * Convert the Mongo document to an ExperimentInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface: ToInterface<ExperimentInterface> = (doc) => {
  const experiment = removeMongooseFields(doc);
  return upgradeExperimentDoc(
    (experiment as unknown) as LegacyExperimentInterface
  );
};

async function findExperiments(
  context: ReqContext | ApiReqContext,
  query: FilterQuery<ExperimentDocument>,
  limit?: number,
  sortBy?: SortFilter
): Promise<ExperimentInterface[]> {
  let cursor = getCollection(COLLECTION).find(query);

  if (limit) {
    cursor = cursor.limit(limit);
  }
  if (sortBy) {
    cursor = cursor.sort(sortBy);
  }
  const experiments = (await cursor.toArray()).map(toInterface);

  return experiments.filter((exp) =>
    context.permissions.canReadSingleProjectResource(exp.project)
  );
}

export async function getExperimentById(
  context: ReqContext | ApiReqContext,
  id: string
): Promise<ExperimentInterface | null> {
  const doc = await getCollection(COLLECTION).findOne({
    organization: context.org.id,
    id,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return context.permissions.canReadSingleProjectResource(experiment.project)
    ? experiment
    : null;
}

export async function getAllExperiments(
  context: ReqContext | ApiReqContext,
  {
    project,
    includeArchived = false,
    type,
  }: {
    project?: string;
    includeArchived?: boolean;
    type?: ExperimentType;
  } = {}
): Promise<ExperimentInterface[]> {
  const query: FilterQuery<ExperimentDocument> = {
    organization: context.org.id,
  };

  if (project) {
    query.project = project;
  }

  if (!includeArchived) {
    query.archived = { $ne: true };
  }

  if (type === "multi-armed-bandit") {
    query.type = "multi-armed-bandit";
  } else if (type === "standard") {
    query.type = { $in: ["standard", null] };
  }

  return await findExperiments(context, query);
}

export async function hasArchivedExperiments(
  context: ReqContext | ApiReqContext,
  project?: string
): Promise<boolean> {
  const query: FilterQuery<ExperimentDocument> = {
    organization: context.org.id,
    archived: true,
  };

  if (project) {
    query.project = project;
  }

  const e = await getCollection(COLLECTION).findOne(query);
  return !!e;
}

export async function getExperimentByTrackingKey(
  context: ReqContext | ApiReqContext,
  trackingKey: string
): Promise<ExperimentInterface | null> {
  const doc = await getCollection(COLLECTION).findOne({
    organization: context.org.id,
    trackingKey,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return context.permissions.canReadSingleProjectResource(experiment.project)
    ? experiment
    : null;
}

export async function getExperimentsByIds(
  context: ReqContext | ApiReqContext,
  ids: string[]
): Promise<ExperimentInterface[]> {
  if (!ids.length) return [];
  return await findExperiments(context, {
    id: { $in: ids },
    organization: context.org.id,
  });
}

export async function getExperimentsByTrackingKeys(
  context: ReqContext | ApiReqContext,
  trackingKeys: string[]
): Promise<ExperimentInterface[]> {
  return await findExperiments(context, {
    trackingKey: { $in: trackingKeys },
    organization: context.org.id,
  });
}

export async function getSampleExperiment(
  organization: string
): Promise<ExperimentInterface | null> {
  const exp = await getCollection(COLLECTION).findOne({
    organization,
    id: /^exp_sample_/,
  });

  return exp ? toInterface(exp) : null;
}

export async function createExperiment({
  data,
  context,
}: {
  data: Partial<ExperimentInterface>;
  context: ReqContext | ApiReqContext;
}): Promise<ExperimentInterface> {
  data.organization = context.org.id;

  if (!data.name) throw new Error("Cannot create experiment with empty name!");

  if (!data.trackingKey) {
    data.trackingKey = await generateTrackingKey(
      data,
      async (key: string) => await getExperimentByTrackingKey(context, key)
    );
  }

  const nextUpdate = determineNextDate(
    context.org.settings?.updateSchedule || null
  );

  const exp = await ExperimentModel.create({
    id: uniqid("exp_"),
    // If this is a sample experiment, we'll override the id with data.id
    ...data,
    //set the default phase seed to uuid
    phases: data.phases
      ? data.phases.map(({ ...phase }) => {
          return {
            ...phase,
            seed: phase.seed || uuidv4(),
          };
        })
      : [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    autoSnapshots: nextUpdate !== null,
    lastSnapshotAttempt: new Date(),
    nextSnapshotAttempt: nextUpdate,
  });

  await onExperimentCreate({
    context,
    experiment: toInterface(exp),
  });

  if (data.tags) {
    await addTags(data.organization, data.tags);
  }

  return toInterface(exp);
}

export async function updateExperiment({
  context,
  experiment,
  changes,
  bypassWebhooks = false,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  changes: Changeset;
  bypassWebhooks?: boolean;
}): Promise<ExperimentInterface> {
  // TODO: are there some changes where we don't want to update the dateUpdated?
  const allChanges = {
    ...changes,
  };
  allChanges.dateUpdated = new Date();

  if (allChanges.name === "")
    throw new Error("Cannot set empty name for experiment!");

  await ExperimentModel.updateOne(
    {
      id: experiment.id,
      organization: context.org.id,
    },
    {
      $set: allChanges,
    }
  );

  const updated = { ...experiment, ...allChanges };

  // TODO: are there some changes where we want to skip calling this?
  await onExperimentUpdate({
    context,
    oldExperiment: experiment,
    newExperiment: updated,
    bypassWebhooks,
  });

  return updated;
}

export async function getExperimentsByMetric(
  context: ReqContext | ApiReqContext,
  metricId: string
): Promise<{ id: string; name: string }[]> {
  const experiments = await findExperiments(context, {
    organization: context.org.id,
    $or: [
      { metrics: metricId },
      { goalMetrics: metricId },
      { guardrails: metricId },
      { guardrailMetrics: metricId },
      { secondaryMetrics: metricId },
      { activationMetric: metricId },
    ],
  });

  return experiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
  }));
}

export async function getExperimentByIdea(
  context: ReqContext | ApiReqContext,
  idea: IdeaDocument
): Promise<ExperimentInterface | null> {
  const doc = await getCollection(COLLECTION).findOne({
    organization: context.org.id,
    ideaSource: idea.id,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return context.permissions.canReadSingleProjectResource(experiment.project)
    ? experiment
    : null;
}

export async function getExperimentsToUpdate(
  ids: string[]
): Promise<Pick<ExperimentInterface, "id" | "organization">[]> {
  const experiments = await getCollection(COLLECTION)
    .find({
      datasource: {
        $exists: true,
        $ne: "",
      },
      status: "running",
      autoSnapshots: true,
      nextSnapshotAttempt: {
        $exists: true,
        $lte: new Date(),
      },
      id: {
        $nin: ids,
      },
    })
    .project({
      id: true,
      organization: true,
    })
    .limit(100)
    .sort({ nextSnapshotAttempt: 1 })
    .toArray();

  return experiments.map((exp) => ({
    id: exp.id,
    organization: exp.organization,
  }));
}

export async function getExperimentsToUpdateLegacy(
  latestDate: Date
): Promise<Pick<ExperimentInterface, "id" | "organization">[]> {
  const experiments = await getCollection(COLLECTION)
    .find({
      datasource: {
        $exists: true,
        $ne: "",
      },
      status: "running",
      autoSnapshots: true,
      nextSnapshotAttempt: {
        $exists: false,
      },
      lastSnapshotAttempt: {
        $lte: latestDate,
      },
    })
    .project({
      id: true,
      organization: true,
    })
    .limit(100)
    .sort({ nextSnapshotAttempt: 1 })
    .toArray();

  return experiments.map((exp) => ({
    id: exp.id,
    organization: exp.organization,
  }));
}

export async function getPastExperimentsByDatasource(
  context: ReqContext | ApiReqContext,
  datasource: string
): Promise<
  Pick<ExperimentInterface, "id" | "trackingKey" | "exposureQueryId">[]
> {
  const experiments = await getCollection(COLLECTION)
    .find({
      organization: context.org.id,
      datasource,
    })
    .project({
      _id: false,
      id: true,
      trackingKey: true,
      exposureQueryId: true,
      project: true,
    })
    .toArray();

  const experimentsUserCanAccess = experiments.filter((exp) =>
    context.permissions.canReadSingleProjectResource(exp.project)
  );

  return experimentsUserCanAccess.map((exp) => ({
    id: exp.id,
    trackingKey: exp.trackingKey,
    exposureQueryId: exp.exposureQueryId,
  }));
}

export async function getExperimentsUsingMetric(
  context: ReqContext | ApiReqContext,
  metricId: string,
  limit?: number
): Promise<ExperimentInterface[]> {
  const experiments = await findExperiments(
    context,
    {
      organization: context.org.id,
      $or: [
        { metrics: metricId },
        { goalMetrics: metricId },
        { guardrails: metricId },
        { guardrailMetrics: metricId },
        { secondaryMetrics: metricId },
        { activationMetric: metricId },
      ],
      archived: {
        $ne: true,
      },
    },
    // hard cap at 1000 to prevent too many results
    limit !== undefined ? limit : 1000,
    { _id: -1 }
  );

  return experiments;
}

export async function getRecentExperimentsUsingMetric(
  context: ReqContext | ApiReqContext,
  metricId: string
): Promise<
  Pick<
    ExperimentInterface,
    "id" | "name" | "status" | "phases" | "results" | "analysis"
  >[]
> {
  const experiments = await findExperiments(
    context,
    {
      organization: context.org.id,
      $or: [
        { metrics: metricId },
        { goalMetrics: metricId },
        { guardrails: metricId },
        { guardrailMetrics: metricId },
        { secondaryMetrics: metricId },
        { activationMetric: metricId },
      ],
      archived: {
        $ne: true,
      },
    },
    10,
    { _id: -1 }
  );

  return experiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
    status: exp.status,
    phases: exp.phases,
    results: exp.results,
    analysis: exp.analysis,
  }));
}

export async function deleteExperimentSegment(
  context: ReqContext | ApiReqContext,
  segment: string
): Promise<void> {
  const exps = await getExperimentsUsingSegment(context, segment);

  if (!exps.length) return;

  await ExperimentModel.updateMany(
    { organization: context.org.id, segment },
    {
      $set: { segment: "" },
    }
  );

  exps.forEach((previous) => {
    const current = cloneDeep(previous);
    current.segment = "";

    onExperimentUpdate({
      context,
      oldExperiment: previous,
      newExperiment: current,
      bypassWebhooks: true,
    }).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on experiment update");
    });
  });
}

export async function getExperimentsForActivityFeed(
  context: ReqContext | ApiReqContext,
  ids: string[]
): Promise<Pick<ExperimentInterface, "id" | "name">[]> {
  const experiments = await getCollection(COLLECTION)
    .find({
      organization: context.org.id,
      id: {
        $in: ids,
      },
    })
    .project({
      _id: false,
      id: true,
      name: true,
      project: true,
    })
    .toArray();

  const filteredExperiments = experiments.filter((exp) =>
    context.permissions.canReadSingleProjectResource(exp.project)
  );

  return filteredExperiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
  }));
}

/**
 * Finds an experiment for an organization
 * @param experimentId
 * @param context
 */
const findExperiment = async ({
  experimentId,
  context,
}: FindOrganizationOptions): Promise<ExperimentInterface | null> => {
  const doc = await getCollection(COLLECTION).findOne({
    id: experimentId,
    organization: context.org.id,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return context.permissions.canReadSingleProjectResource(experiment.project)
    ? experiment
    : null;
};

// region Events

/**
 * @param context
 * @param experiment
 * @return event.id
 */
export const logExperimentCreated = async (
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface
) => {
  const apiExperiment = await toExperimentApiInterface(context, experiment);

  // If experiment is part of the SDK payload, it affects all environments
  // Otherwise, it doesn't affect any
  const changedEnvs = includeExperimentInPayload(experiment)
    ? getEnvironmentIdsFromOrg(context.org)
    : [];

  await createEvent({
    context,
    object: "experiment",
    objectId: experiment.id,
    event: "created",
    data: {
      object: apiExperiment,
    },
    projects: [apiExperiment.project],
    tags: apiExperiment.tags,
    environments: changedEnvs,
    containsSecrets: false,
  });
};

/**
 * @param context
 * @param current
 * @return previous
 */
export const logExperimentUpdated = async ({
  context,
  current,
  previous,
}: {
  context: ReqContext | ApiReqContext;
  current: ExperimentInterface;
  previous: ExperimentInterface;
}) => {
  const previousApiExperimentPromise = toExperimentApiInterface(
    context,
    previous
  );

  const currentApiExperimentPromise = toExperimentApiInterface(
    context,
    current
  );
  const [previousApiExperiment, currentApiExperiment] = await Promise.all([
    previousApiExperimentPromise,
    currentApiExperimentPromise,
  ]);

  // If experiment is part of the SDK payload, it affects all environments
  // Otherwise, it doesn't affect any
  const hasPayloadChanges = hasChangesForSDKPayloadRefresh(previous, current);

  const changedEnvs = hasPayloadChanges
    ? getEnvironmentIdsFromOrg(context.org)
    : [];

  await createEvent({
    context,
    object: "experiment",
    objectId: current.id,
    event: "updated",
    data: {
      object: currentApiExperiment,
      previous_object: previousApiExperiment,
    },
    projects: Array.from(
      new Set([previousApiExperiment.project, currentApiExperiment.project])
    ),
    tags: Array.from(
      new Set([...previousApiExperiment.tags, ...currentApiExperiment.tags])
    ),
    environments: changedEnvs,
    containsSecrets: false,
  });
};

/**
 * Deletes an experiment by ID and logs the event for the organization
 * @param experiment
 * @param organization
 */
export async function deleteExperimentByIdForOrganization(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface
) {
  try {
    await ExperimentModel.deleteOne({
      id: experiment.id,
      organization: context.org.id,
    });

    await VisualChangesetModel.deleteMany({ experiment: experiment.id });

    await onExperimentDelete(context, experiment);
  } catch (e) {
    logger.error(e);
  }
}

/**
 * Delete experiments belonging to a project
 * @param projectId
 * @param organization
 */
export async function deleteAllExperimentsForAProject({
  projectId,
  context,
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
}) {
  const experimentsToDelete = await getCollection(COLLECTION)
    .find({
      organization: context.org.id,
      project: projectId,
    })
    .toArray();

  for (const experiment of experimentsToDelete) {
    await experiment.delete();
    VisualChangesetModel.deleteMany({ experiment: experiment.id });
    await onExperimentDelete(context, toInterface(experiment));
  }
}

/**
 * Removes the tag from any experiments that have it
 * and logs the experiment.updated event
 * @param context
 * @param tag
 */
export const removeTagFromExperiments = async ({
  context,
  tag,
}: {
  context: ReqContext | ApiReqContext;
  tag: string;
}): Promise<void> => {
  const query = { organization: context.org.id, tags: tag };
  const previousExperiments = await findExperiments(context, query);

  await ExperimentModel.updateMany(query, {
    $pull: { tags: tag },
  });

  logAllChanges(context, previousExperiments, (exp) => ({
    ...exp,
    tags: exp.tags.filter((t) => t !== tag),
  }));
};

export async function removeMetricFromExperiments(
  context: ReqContext | ApiReqContext,
  metricId: string
) {
  const oldExperiments: Record<
    string,
    {
      previous: ExperimentInterface | null;
      current: ExperimentInterface | null;
    }
  > = {};

  const orgId = context.org.id;

  const oldMetricQuery = { organization: orgId, metrics: metricId };
  const oldGuardRailsQuery = { organization: orgId, guardrails: metricId };
  const goalQuery = { organization: orgId, goalMetrics: metricId };
  const secondaryQuery = { organization: orgId, secondaryMetrics: metricId };
  const guardrailQuery = { organization: orgId, guardrailMetrics: metricId };
  const activationMetricQuery = {
    organization: orgId,
    activationMetric: metricId,
  };
  const docsToTrackChanges = await findExperiments(context, {
    $or: [
      oldMetricQuery,
      oldGuardRailsQuery,
      goalQuery,
      secondaryQuery,
      guardrailQuery,
      activationMetricQuery,
    ],
  });

  docsToTrackChanges.forEach((experiment: ExperimentInterface) => {
    if (!oldExperiments[experiment.id]) {
      oldExperiments[experiment.id] = {
        previous: experiment,
        current: null,
      };
    }
  });

  // Remove from metrics
  await ExperimentModel.updateMany(oldMetricQuery, {
    $pull: { metrics: metricId },
  });

  // Remove from guardrails
  await ExperimentModel.updateMany(oldGuardRailsQuery, {
    $pull: { guardrails: metricId },
  });

  // Remove from goalMetrics
  await ExperimentModel.updateMany(goalQuery, {
    $pull: { goalMetrics: metricId },
  });

  // Remove from secondaryMetrics
  await ExperimentModel.updateMany(secondaryQuery, {
    $pull: { secondaryMetrics: metricId },
  });

  // Remove from guardrailMetrics
  await ExperimentModel.updateMany(guardrailQuery, {
    $pull: { guardrailMetrics: metricId },
  });

  // Remove from activationMetric
  await ExperimentModel.updateMany(activationMetricQuery, {
    $set: { activationMetric: "" },
  });

  const ids = Object.keys(oldExperiments);

  const updatedExperiments = await findExperiments(context, {
    organization: context.org.id,
    id: {
      $in: ids,
    },
  });

  // Populate updated experiments
  updatedExperiments.forEach((experiment) => {
    const changeSet = oldExperiments[experiment.id];
    if (changeSet) {
      changeSet.current = experiment;
    }
  });

  // Log all the changes
  each(oldExperiments, (changeSet) => {
    const { previous, current } = changeSet;
    if (current && previous) {
      onExperimentUpdate({
        context,
        oldExperiment: previous,
        newExperiment: current,
        bypassWebhooks: true,
      }).catch((e) => {
        logger.error(e, "Error refreshing SDK Payload on experiment update");
      });
    }
  });
}

export async function removeProjectFromExperiments(
  context: ReqContext | ApiReqContext,
  project: string
) {
  const query = { organization: context.org.id, project };
  const previousExperiments = await findExperiments(context, query);

  await ExperimentModel.updateMany(query, { $set: { project: "" } });

  logAllChanges(context, previousExperiments, (exp) => ({
    ...exp,
    project: "",
  }));
}

export async function addLinkedFeatureToExperiment(
  context: ReqContext | ApiReqContext,
  experimentId: string,
  featureId: string,
  experiment?: ExperimentInterface | null
) {
  if (!experiment) {
    experiment = await findExperiment({
      experimentId,
      context,
    });
  }

  if (!experiment) return;

  if (experiment.linkedFeatures?.includes(featureId)) return;

  await ExperimentModel.updateOne(
    {
      id: experimentId,
      organization: context.org.id,
    },
    {
      $addToSet: {
        linkedFeatures: featureId,
      },
    }
  );

  onExperimentUpdate({
    context,
    oldExperiment: experiment,
    newExperiment: {
      ...experiment,
      linkedFeatures: [...(experiment.linkedFeatures || []), featureId],
    },
  }).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on experiment update");
  });
}

export async function removeLinkedFeatureFromExperiment(
  context: ReqContext | ApiReqContext,
  experimentId: string,
  featureId: string
) {
  const experiment = await findExperiment({
    experimentId,
    context,
  });

  if (!experiment) return;

  if (!experiment.linkedFeatures?.includes(featureId)) return;

  await ExperimentModel.updateOne(
    {
      id: experimentId,
      organization: context.org.id,
    },
    {
      $pull: {
        linkedFeatures: featureId,
      },
    }
  );

  onExperimentUpdate({
    context,
    oldExperiment: experiment,
    newExperiment: {
      ...experiment,
      linkedFeatures: (experiment.linkedFeatures || []).filter(
        (f) => f !== featureId
      ),
    },
  }).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on experiment update");
  });
}

function logAllChanges(
  context: ReqContext | ApiReqContext,
  previousExperiments: ExperimentInterface[],
  applyChanges: (exp: ExperimentInterface) => ExperimentInterface | null
) {
  previousExperiments.forEach((previous) => {
    const current = applyChanges(cloneDeep(previous));
    if (!current) return;
    onExperimentUpdate({
      context,
      oldExperiment: previous,
      newExperiment: current,
    }).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on experiment update");
    });
  });
}

export async function getExperimentsUsingSegment(
  context: ReqContext | ApiReqContext,
  id: string
) {
  return await findExperiments(context, {
    organization: context.org.id,
    segment: id,
  });
}

/**
 * @param context
 * @param experiment
 * @return experiment
 */
export const logExperimentDeleted = async (
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface
) => {
  const apiExperiment = await toExperimentApiInterface(context, experiment);

  // If experiment is part of the SDK payload, it affects all environments
  // Otherwise, it doesn't affect any
  const changedEnvs = includeExperimentInPayload(experiment)
    ? getEnvironmentIdsFromOrg(context.org)
    : [];

  await createEvent({
    context,
    object: "experiment",
    objectId: experiment.id,
    event: "deleted",
    data: {
      object: apiExperiment,
    },
    projects: [apiExperiment.project],
    environments: changedEnvs,
    tags: apiExperiment.tags,
    containsSecrets: false,
  });
};

// type guard
const _isValidVisualExperiment = (
  e: Partial<VisualExperiment>
): e is VisualExperiment => !!e.experiment && !!e.visualChangeset;

export async function getExperimentMapForFeature(
  context: ReqContext | ApiReqContext,
  featureId: string
): Promise<Map<string, ExperimentInterface>> {
  const experiments = await findExperiments(context, {
    organization: context.org.id,
    archived: { $ne: true },
    linkedFeatures: featureId,
  });

  return new Map(
    experiments
      .filter((e) => includeExperimentInPayload(e))
      .map((e) => [e.id, e])
  );
}

export async function getAllPayloadExperiments(
  context: ReqContext | ApiReqContext,
  project?: string
): Promise<Map<string, ExperimentInterface>> {
  const experiments = await findExperiments(context, {
    organization: context.org.id,
    ...(project ? { project } : {}),
    archived: { $ne: true },
    $or: [
      {
        linkedFeatures: { $exists: true, $ne: [] },
      },
      {
        hasVisualChangesets: true,
      },
      {
        hasURLRedirects: true,
      },
    ],
  });

  return new Map(
    experiments
      .filter((e) => includeExperimentInPayload(e))
      .map((e) => [e.id, e])
  );
}

export const getAllVisualExperiments = async (
  context: ReqContext | ApiReqContext,
  experimentMap: Map<string, ExperimentInterface>
): Promise<Array<VisualExperiment>> => {
  const visualChangesets = await findVisualChangesets(context.org.id);

  if (!visualChangesets.length) return [];

  const visualChangesByExperimentId = visualChangesets.reduce<
    Record<string, Array<VisualChange>>
  >((acc, c) => {
    if (!acc[c.experiment]) acc[c.experiment] = [];
    acc[c.experiment] = acc[c.experiment].concat(c.visualChanges);
    return acc;
  }, {});

  const hasVisualChangesForVariation = (
    experimentId: string,
    variationId: string
  ): boolean => {
    const changes = visualChangesByExperimentId[experimentId];
    if (!changes) return false;
    return hasVisualChanges(
      changes.filter((vc) => vc.variation === variationId)
    );
  };

  return visualChangesets
    .map<VisualExperiment>((c) => ({
      experiment: experimentMap.get(c.experiment) as ExperimentInterface,
      visualChangeset: c,
      type: "visual",
    }))
    .filter(_isValidVisualExperiment)
    .filter((e) => {
      // Exclude experiments from SDK payload
      if (!includeExperimentInPayload(e.experiment)) return false;

      // Exclude experiments that are stopped and the released variation doesn’t have any visual changes
      if (
        e.experiment.status === "stopped" &&
        !hasVisualChangesForVariation(
          e.experiment.id,
          e.experiment.releasedVariationId
        )
      ) {
        return false;
      }
      return true;
    });
};

export const getAllURLRedirectExperiments = async (
  context: ReqContext | ApiReqContext,
  experimentMap: Map<string, ExperimentInterface>
): Promise<Array<URLRedirectExperiment>> => {
  const redirects = await context.models.urlRedirects.getAll();

  if (!redirects.length) return [];

  const exps: URLRedirectExperiment[] = [];

  redirects.forEach((r) => {
    const experiment = experimentMap.get(r.experiment);
    if (!experiment) return;

    // Exclude experiments from SDK payload
    if (!includeExperimentInPayload(experiment)) return;

    // Exclude experiments that are stopped and the released variation doesn’t have a destination URL
    if (experiment.status === "stopped") {
      const destination = r.destinationURLs.find(
        (d) => d.variation === experiment.releasedVariationId
      );
      if (!destination || !destination.url) return;
    }

    exps.push({
      type: "redirect",
      experiment,
      urlRedirect: r,
    });
  });

  return exps;
};

export function getPayloadKeysForAllEnvs(
  context: ReqContext | ApiReqContext,
  projects: string[]
) {
  const uniqueProjects = new Set(projects);

  const environments = getEnvironmentIdsFromOrg(context.org);

  const keys: SDKPayloadKey[] = [];
  uniqueProjects.forEach((p) => {
    environments.forEach((e) => {
      keys.push({
        environment: e,
        project: p,
      });
    });
  });
  return keys;
}

export function getPayloadKeys(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  linkedFeatures?: FeatureInterface[]
): SDKPayloadKey[] {
  // If experiment is not included in the SDK payload
  if (!includeExperimentInPayload(experiment, linkedFeatures)) {
    return [];
  }

  const environments: string[] = getEnvironmentIdsFromOrg(context.org);
  const project = experiment.project ?? "";

  // Visual editor and URL redirect experiments always affect all environments
  if (experiment.hasVisualChangesets || experiment.hasURLRedirects) {
    const keys: SDKPayloadKey[] = [];

    environments.forEach((e) => {
      // Always update the "no-project" payload
      keys.push({ environment: e, project: "" });
      // If the experiment is in a project, update that payload as well
      if (project) keys.push({ environment: e, project });
    });

    return keys;
  }

  // Feature flag experiments only affect the environments where the experiment rule is active
  if (linkedFeatures && linkedFeatures.length > 0) {
    return getAffectedSDKPayloadKeys(
      linkedFeatures,
      environments,
      (rule) =>
        rule.type === "experiment-ref" &&
        rule.experimentId === experiment.id &&
        rule.enabled !== false
    );
  }

  // Otherwise, if no linked changes, there are no affected payload keys
  return [];
}

const getExperimentChanges = (
  experiment: ExperimentInterface
): Omit<ExperimentInterface, "variations"> & {
  variations: Partial<Variation>[];
} => {
  const importantKeys: Array<keyof ExperimentInterface> = [
    "trackingKey",
    "project",
    "hashAttribute",
    "hashVersion",
    "name",
    "archived",
    "status",
    "releasedVariationId",
    "excludeFromPayload",
    "autoAssign",
    "variations",
    "phases",
  ];

  return {
    ...pick(experiment, importantKeys),
    variations: experiment.variations.map((v) =>
      pick(v, ["id", "name", "key"])
    ),
  };
};

const hasChangesForSDKPayloadRefresh = (
  oldExperiment: ExperimentInterface,
  newExperiment: ExperimentInterface
): boolean => {
  // Skip experiments that don't have linked changes
  if (
    !includeExperimentInPayload(oldExperiment) &&
    !includeExperimentInPayload(newExperiment)
  ) {
    return false;
  }

  const oldChanges = getExperimentChanges(oldExperiment);
  const newChanges = getExperimentChanges(newExperiment);

  return !isEqual(oldChanges, newChanges);
};

const onExperimentCreate = async ({
  context,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}) => {
  await logExperimentCreated(context, experiment);
};

const onExperimentUpdate = async ({
  context,
  oldExperiment,
  newExperiment,
  bypassWebhooks = false,
}: {
  context: ReqContext | ApiReqContext;
  oldExperiment: ExperimentInterface;
  newExperiment: ExperimentInterface;
  bypassWebhooks?: boolean;
}) => {
  await logExperimentUpdated({
    context,
    current: newExperiment,
    previous: oldExperiment,
  });

  if (
    !bypassWebhooks &&
    hasChangesForSDKPayloadRefresh(oldExperiment, newExperiment)
  ) {
    // Get linked features
    const featureIds = new Set([
      ...(oldExperiment.linkedFeatures || []),
      ...(newExperiment.linkedFeatures || []),
    ]);
    let linkedFeatures: FeatureInterface[] = [];
    if (featureIds.size > 0) {
      linkedFeatures = await getFeaturesByIds(context, [...featureIds]);
    }

    const oldPayloadKeys = oldExperiment
      ? getPayloadKeys(context, oldExperiment, linkedFeatures)
      : [];
    const newPayloadKeys = getPayloadKeys(
      context,
      newExperiment,
      linkedFeatures
    );
    const payloadKeys = uniqWith(
      [...oldPayloadKeys, ...newPayloadKeys],
      isEqual
    );

    refreshSDKPayloadCache(context, payloadKeys).catch((e) => {
      logger.error(e, "Error refreshing SDK payload cache");
    });
  }
};

const onExperimentDelete = async (
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface
) => {
  await logExperimentDeleted(context, experiment);

  const featureIds = [...(experiment.linkedFeatures || [])];
  let linkedFeatures: FeatureInterface[] = [];
  if (featureIds.length > 0) {
    linkedFeatures = await getFeaturesByIds(context, featureIds);
  }

  const payloadKeys = getPayloadKeys(context, experiment, linkedFeatures);
  refreshSDKPayloadCache(context, payloadKeys).catch((e) => {
    logger.error(e, "Error refreshing SDK payload cache");
  });
};
