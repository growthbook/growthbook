import { each, isEqual, omit, pick, uniqBy, uniqWith } from "lodash";
import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import cloneDeep from "lodash/cloneDeep";
import { includeExperimentInPayload, hasVisualChanges } from "shared/util";
import { hasReadAccess } from "shared/permissions";
import {
  Changeset,
  ExperimentInterface,
  LegacyExperimentInterface,
  Variation,
} from "../../types/experiment";
import { ReqContext } from "../../types/organization";
import { VisualChange } from "../../types/visual-changeset";
import {
  determineNextDate,
  generateTrackingKey,
  toExperimentApiInterface,
} from "../services/experiments";
import {
  ExperimentCreatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
} from "../events/notification-events";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import { logger } from "../util/logger";
import { upgradeExperimentDoc } from "../util/migrations";
import { refreshSDKPayloadCache, VisualExperiment } from "../services/features";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { EventAuditUser } from "../events/event-types";
import { FeatureInterface } from "../../types/feature";
import { getAffectedSDKPayloadKeys } from "../util/features";
import { getEnvironmentIdsFromOrg } from "../services/organizations";
import { ApiReqContext } from "../../types/api";
import { IdeaDocument } from "./IdeasModel";
import { addTags } from "./TagModel";
import { createEvent } from "./EventModel";
import {
  findVisualChangesets,
  VisualChangesetModel,
} from "./VisualChangesetModel";
import { getFeaturesByIds } from "./FeatureModel";

type FindOrganizationOptions = {
  experimentId: string;
  context: ReqContext | ApiReqContext;
};

type FilterKeys = ExperimentInterface & { _id: string };

type SortFilter = {
  [key in keyof Partial<FilterKeys>]: 1 | -1;
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
  metrics: [String],
  metricOverrides: [
    {
      _id: false,
      id: String,
      conversionWindowHours: Number,
      conversionDelayHours: Number,
      winRisk: Number,
      loseRisk: Number,
      regressionAdjustmentOverride: Boolean,
      regressionAdjustmentEnabled: Boolean,
      regressionAdjustmentDays: Number,
    },
  ],
  guardrails: [String],
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
      namespace: {},
      seed: String,
      variationWeights: [Number],
      groups: [String],
    },
  ],
  data: String,
  lastSnapshotAttempt: Date,
  nextSnapshotAttempt: Date,
  autoSnapshots: Boolean,
  ideaSource: String,
  regressionAdjustmentEnabled: Boolean,
  hasVisualChangesets: Boolean,
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
});

type ExperimentDocument = mongoose.Document & ExperimentInterface;

const ExperimentModel = mongoose.model<ExperimentInterface>(
  "Experiment",
  experimentSchema
);

/**
 * Convert the Mongo document to an ExperimentInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: ExperimentDocument): ExperimentInterface => {
  const experiment = omit(doc.toJSON(), ["__v", "_id"]);
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
  let cursor = ExperimentModel.find(query);
  if (limit) {
    cursor = cursor.limit(limit);
  }
  if (sortBy) {
    cursor = cursor.sort(sortBy);
  }
  const experiments = (await cursor).map(toInterface);

  return experiments.filter((exp) =>
    hasReadAccess(context.readAccessFilter, exp.project)
  );
}

export async function getExperimentById(
  context: ReqContext | ApiReqContext,
  id: string
): Promise<ExperimentInterface | null> {
  const doc = await ExperimentModel.findOne({
    organization: context.org.id,
    id,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return hasReadAccess(context.readAccessFilter, experiment.project)
    ? experiment
    : null;
}

export async function getAllExperiments(
  context: ReqContext | ApiReqContext,
  project?: string
): Promise<ExperimentInterface[]> {
  const query: FilterQuery<ExperimentDocument> = {
    organization: context.org.id,
  };

  if (project) {
    query.project = project;
  }

  return await findExperiments(context, query);
}

export async function getExperimentByTrackingKey(
  context: ReqContext | ApiReqContext,
  trackingKey: string
): Promise<ExperimentInterface | null> {
  const doc = await ExperimentModel.findOne({
    organization: context.org.id,
    trackingKey,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return hasReadAccess(context.readAccessFilter, experiment.project)
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
  const exp = await ExperimentModel.findOne({
    organization,
    id: /^exp_sample_/,
  });

  return exp ? toInterface(exp) : null;
}

export async function createExperiment({
  data,
  context,
  user,
}: {
  data: Partial<ExperimentInterface>;
  context: ReqContext | ApiReqContext;
  user: EventAuditUser;
}): Promise<ExperimentInterface> {
  data.organization = context.org.id;

  if (!data.trackingKey) {
    // Try to generate a unique tracking key based on the experiment name
    let n = 1;
    let found = null;
    while (n < 10 && !found) {
      const key = generateTrackingKey(data.name || data.id || "", n);
      if (!(await getExperimentByTrackingKey(context, key))) {
        found = key;
      }
      n++;
    }

    // Fall back to uniqid if couldn't generate
    data.trackingKey = found || uniqid();
  }

  const nextUpdate = determineNextDate(
    context.org.settings?.updateSchedule || null
  );

  const exp = await ExperimentModel.create({
    id: uniqid("exp_"),
    // If this is a sample experiment, we'll override the id with data.id
    ...data,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    autoSnapshots: nextUpdate !== null,
    lastSnapshotAttempt: new Date(),
    nextSnapshotAttempt: nextUpdate,
  });

  await onExperimentCreate({
    context,
    experiment: exp,
    user,
  });

  if (data.tags) {
    await addTags(data.organization, data.tags);
  }

  return toInterface(exp);
}

export async function updateExperiment({
  context,
  experiment,
  user,
  changes,
  bypassWebhooks = false,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  user: EventAuditUser;
  changes: Changeset;
  bypassWebhooks?: boolean;
}): Promise<ExperimentInterface | null> {
  await ExperimentModel.updateOne(
    {
      id: experiment.id,
      organization: context.org.id,
    },
    {
      $set: changes,
    }
  );

  const updated = { ...experiment, ...changes };

  await onExperimentUpdate({
    context,
    oldExperiment: experiment,
    newExperiment: updated,
    user,
    bypassWebhooks,
  });

  return updated;
}

export async function getExperimentsByMetric(
  context: ReqContext | ApiReqContext,
  metricId: string
): Promise<{ id: string; name: string }[]> {
  const experiments: {
    id: string;
    name: string;
  }[] = [];

  // Using as a goal metric
  const goals = await findExperiments(context, {
    organization: context.org.id,
    metrics: metricId,
  });
  goals.forEach((exp) => {
    experiments.push({
      id: exp.id,
      name: exp.name,
    });
  });

  // Using as a guardrail metric
  const guardrails = await findExperiments(context, {
    organization: context.org.id,
    guardrails: metricId,
  });
  guardrails.forEach((exp) => {
    experiments.push({
      id: exp.id,
      name: exp.name,
    });
  });

  // Using as an activation metric
  const activations = await findExperiments(context, {
    organization: context.org.id,
    activationMetric: metricId,
  });
  activations.forEach((exp) => {
    experiments.push({
      id: exp.id,
      name: exp.name,
    });
  });

  return uniqBy(experiments, "id");
}

export async function getExperimentByIdea(
  context: ReqContext | ApiReqContext,
  idea: IdeaDocument
): Promise<ExperimentInterface | null> {
  const doc = await ExperimentModel.findOne({
    organization: context.org.id,
    ideaSource: idea.id,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return hasReadAccess(context.readAccessFilter, experiment.project)
    ? experiment
    : null;
}

export async function getExperimentsToUpdate(
  ids: string[]
): Promise<Pick<ExperimentInterface, "id" | "organization">[]> {
  const experiments = await ExperimentModel.find(
    {
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
    },
    {
      id: true,
      organization: true,
    },
    {
      limit: 100,
      sort: { nextSnapshotAttempt: 1 },
    }
  );
  return experiments.map((exp) => ({
    id: exp.id,
    organization: exp.organization,
  }));
}

export async function getExperimentsToUpdateLegacy(
  latestDate: Date
): Promise<Pick<ExperimentInterface, "id" | "organization">[]> {
  const experiments = await ExperimentModel.find(
    {
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
    },
    {
      id: true,
      organization: true,
    },
    {
      limit: 100,
      sort: {
        nextSnapshotAttempt: 1,
      },
    }
  );
  return experiments.map((exp) => ({
    id: exp.id,
    organization: exp.organization,
  }));
}

export async function getPastExperimentsByDatasource(
  context: ReqContext | ApiReqContext,
  datasource: string
): Promise<Pick<ExperimentInterface, "id" | "trackingKey">[]> {
  const experiments = await ExperimentModel.find(
    {
      organization: context.org.id,
      datasource,
    },
    {
      _id: false,
      id: true,
      trackingKey: true,
      project: true,
    }
  );

  const experimentsUserCanAccess = experiments.filter((exp) =>
    hasReadAccess(context.readAccessFilter, exp.project)
  );

  return experimentsUserCanAccess.map((exp) => ({
    id: exp.id,
    trackingKey: exp.trackingKey,
  }));
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
        {
          metrics: metricId,
        },
        {
          guardrails: metricId,
        },
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
  user: EventAuditUser,
  segment: string
): Promise<void> {
  const exps = await getExperimentsUsingSegment(segment, context);

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
      user,
    });
  });
}

export async function getExperimentsForActivityFeed(
  context: ReqContext | ApiReqContext,
  ids: string[]
): Promise<Pick<ExperimentInterface, "id" | "name">[]> {
  const experiments = await ExperimentModel.find(
    {
      organization: context.org.id,
      id: {
        $in: ids,
      },
    },
    {
      _id: false,
      id: true,
      name: true,
      project: true,
    }
  );

  const filteredExperiments = experiments.filter((exp) =>
    hasReadAccess(context.readAccessFilter, exp.project)
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
  const doc = await ExperimentModel.findOne({
    id: experimentId,
    organization: context.org.id,
  });

  if (!doc) return null;

  const experiment = toInterface(doc);

  return hasReadAccess(context.readAccessFilter, experiment.project)
    ? experiment
    : null;
};

// region Events

/**
 * @param context
 * @param user
 * @param experiment
 * @return event.id
 */
const logExperimentCreated = async (
  context: ReqContext | ApiReqContext,
  user: EventAuditUser,
  experiment: ExperimentInterface
): Promise<string | undefined> => {
  const { org: organization } = context;
  const apiExperiment = await toExperimentApiInterface(context, experiment);
  const payload: ExperimentCreatedNotificationEvent = {
    object: "experiment",
    event: "experiment.created",
    user,
    data: {
      current: apiExperiment,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  if (emittedEvent) {
    new EventNotifier(emittedEvent.id).perform();
    return emittedEvent.id;
  }
};

/**
 * @param context
 * @param user
 * @param current
 * @return previous
 */
const logExperimentUpdated = async ({
  context,
  user,
  current,
  previous,
}: {
  context: ReqContext | ApiReqContext;
  user: EventAuditUser;
  current: ExperimentInterface;
  previous: ExperimentInterface;
}): Promise<string | undefined> => {
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

  const payload: ExperimentUpdatedNotificationEvent = {
    object: "experiment",
    event: "experiment.updated",
    user,
    data: {
      previous: previousApiExperiment,
      current: currentApiExperiment,
    },
  };

  const emittedEvent = await createEvent(context.org.id, payload);
  if (emittedEvent) {
    new EventNotifier(emittedEvent.id).perform();
    return emittedEvent.id;
  }
};

/**
 * Deletes an experiment by ID and logs the event for the organization
 * @param experiment
 * @param organization
 * @param user
 */
export async function deleteExperimentByIdForOrganization(
  experiment: ExperimentInterface,
  context: ReqContext | ApiReqContext,
  user: EventAuditUser
) {
  try {
    await ExperimentModel.deleteOne({
      id: experiment.id,
      organization: context.org.id,
    });

    await VisualChangesetModel.deleteMany({ experiment: experiment.id });

    await onExperimentDelete(context, user, experiment);
  } catch (e) {
    logger.error(e);
  }
}

/**
 * Delete experiments belonging to a project
 * @param projectId
 * @param organization
 * @param user
 */
export async function deleteAllExperimentsForAProject({
  projectId,
  context,
  user,
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
  user: EventAuditUser;
}) {
  const experimentsToDelete = await ExperimentModel.find({
    organization: context.org.id,
    project: projectId,
  });

  for (const experiment of experimentsToDelete) {
    await experiment.delete();
    VisualChangesetModel.deleteMany({ experiment: experiment.id });
    await onExperimentDelete(context, user, experiment);
  }
}

/**
 * Removes the tag from any experiments that have it
 * and logs the experiment.updated event
 * @param context
 * @param user
 * @param tag
 */
export const removeTagFromExperiments = async ({
  context,
  user,
  tag,
}: {
  context: ReqContext | ApiReqContext;
  user: EventAuditUser;
  tag: string;
}): Promise<void> => {
  const query = { organization: context.org.id, tags: tag };
  const previousExperiments = await findExperiments(context, query);

  await ExperimentModel.updateMany(query, {
    $pull: { tags: tag },
  });

  logAllChanges(context, user, previousExperiments, (exp) => ({
    ...exp,
    tags: exp.tags.filter((t) => t !== tag),
  }));
};

export async function removeMetricFromExperiments(
  metricId: string,
  context: ReqContext | ApiReqContext
) {
  const oldExperiments: Record<
    string,
    {
      previous: ExperimentInterface | null;
      current: ExperimentInterface | null;
    }
  > = {};

  const orgId = context.org.id;

  const metricQuery = { organization: orgId, metrics: metricId };
  const guardRailsQuery = { organization: orgId, guardrails: metricId };
  const activationMetricQuery = {
    organization: orgId,
    activationMetric: metricId,
  };
  const docsToTrackChanges = await findExperiments(context, {
    $or: [metricQuery, guardRailsQuery, activationMetricQuery],
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
  await ExperimentModel.updateMany(metricQuery, {
    $pull: { metrics: metricId },
  });

  // Remove from guardrails
  await ExperimentModel.updateMany(guardRailsQuery, {
    $pull: { guardrails: metricId },
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
  each(oldExperiments, async (changeSet) => {
    const { previous, current } = changeSet;
    if (current && previous) {
      await onExperimentUpdate({
        context,
        oldExperiment: previous,
        newExperiment: current,
        bypassWebhooks: true,
        user: context.auditUser,
      });
    }
  });
}

export async function removeProjectFromExperiments(
  project: string,
  context: ReqContext | ApiReqContext,
  user: EventAuditUser
) {
  const query = { organization: context.org.id, project };
  const previousExperiments = await findExperiments(context, query);

  await ExperimentModel.updateMany(query, { $set: { project: "" } });

  logAllChanges(context, user, previousExperiments, (exp) => ({
    ...exp,
    project: "",
  }));
}

export async function addLinkedFeatureToExperiment(
  context: ReqContext | ApiReqContext,
  user: EventAuditUser,
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
    user,
  });
}

export async function removeLinkedFeatureFromExperiment(
  context: ReqContext | ApiReqContext,
  user: EventAuditUser,
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
    user,
  });
}

function logAllChanges(
  context: ReqContext | ApiReqContext,
  user: EventAuditUser,
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
      user,
    });
  });
}

export async function getExperimentsUsingSegment(
  id: string,
  context: ReqContext | ApiReqContext
) {
  return await findExperiments(context, {
    organization: context.org.id,
    segment: id,
  });
}

/**
 * @param context
 * @param user
 * @param experiment
 * @return experiment
 */
export const logExperimentDeleted = async (
  context: ReqContext | ApiReqContext,
  user: EventAuditUser,
  experiment: ExperimentInterface
): Promise<string | undefined> => {
  const apiExperiment = await toExperimentApiInterface(context, experiment);
  const payload: ExperimentDeletedNotificationEvent = {
    object: "experiment",
    event: "experiment.deleted",
    user,
    data: {
      previous: apiExperiment,
    },
  };

  const emittedEvent = await createEvent(context.org.id, payload);
  if (emittedEvent) {
    new EventNotifier(emittedEvent.id).perform();
    return emittedEvent.id;
  }
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
    .map((c) => ({
      experiment: experimentMap.get(c.experiment),
      visualChangeset: c,
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

export const getPayloadKeys = (
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  linkedFeatures?: FeatureInterface[]
): SDKPayloadKey[] => {
  // If experiment is not included in the SDK payload
  if (!includeExperimentInPayload(experiment, linkedFeatures)) {
    return [];
  }

  const environments: string[] = getEnvironmentIdsFromOrg(context.org);
  const project = experiment.project ?? "";

  // Visual editor experiments always affect all environments
  if (experiment.hasVisualChangesets) {
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

  // Otherwise, if no linked visual editor or feature flag changes, there are no affected payload keys
  return [];
};

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
  // Skip experiments that don't have linked features or visual changesets
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
  user,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  user: EventAuditUser;
}) => {
  await logExperimentCreated(context, user, experiment);
};

const onExperimentUpdate = async ({
  context,
  oldExperiment,
  newExperiment,
  bypassWebhooks = false,
  user,
}: {
  context: ReqContext | ApiReqContext;
  oldExperiment: ExperimentInterface;
  newExperiment: ExperimentInterface;
  bypassWebhooks?: boolean;
  user: EventAuditUser;
}) => {
  await logExperimentUpdated({
    context,
    current: newExperiment,
    previous: oldExperiment,
    user,
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

    refreshSDKPayloadCache(context, payloadKeys);
  }
};

const onExperimentDelete = async (
  context: ReqContext | ApiReqContext,
  user: EventAuditUser,
  experiment: ExperimentInterface
) => {
  await logExperimentDeleted(context, user, experiment);

  const featureIds = [...(experiment.linkedFeatures || [])];
  let linkedFeatures: FeatureInterface[] = [];
  if (featureIds.length > 0) {
    linkedFeatures = await getFeaturesByIds(context, featureIds);
  }

  const payloadKeys = getPayloadKeys(context, experiment, linkedFeatures);
  refreshSDKPayloadCache(context, payloadKeys);
};
