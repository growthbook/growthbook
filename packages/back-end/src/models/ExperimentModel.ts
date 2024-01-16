import { each, isEqual, omit, pick, uniqBy, uniqWith } from "lodash";
import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import cloneDeep from "lodash/cloneDeep";
import { includeExperimentInPayload, hasVisualChanges } from "shared/util";
import { ReadAccessFilter } from "shared/permissions";
import {
  Changeset,
  ExperimentInterface,
  LegacyExperimentInterface,
  Variation,
} from "../../types/experiment";
import { OrganizationInterface } from "../../types/organization";
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
import { IdeaDocument } from "./IdeasModel";
import { addTags } from "./TagModel";
import { createEvent } from "./EventModel";
import {
  findVisualChangesets,
  VisualChangesetModel,
} from "./VisualChangesetModel";
import { getFeaturesByIds } from "./FeatureModel";
import { findProjectById } from "./ProjectModel";

type FindOrganizationOptions = {
  experimentId: string;
  organizationId: string;
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
  const experiments = await cursor;

  return experiments.map(toInterface);
}

export async function getExperimentById(
  organization: string,
  id: string
): Promise<ExperimentInterface | null> {
  const experiment = await ExperimentModel.findOne({ organization, id });
  return experiment ? toInterface(experiment) : null;
}

export async function getAllExperiments(
  organization: string,
  project?: string
): Promise<ExperimentInterface[]> {
  const query: FilterQuery<ExperimentDocument> = {
    organization,
  };

  if (project) {
    query.project = project;
  }

  return await findExperiments(query);
}

export async function getExperimentByTrackingKey(
  organization: string,
  trackingKey: string
): Promise<ExperimentInterface | null> {
  const experiment = await ExperimentModel.findOne({
    organization,
    trackingKey,
  });

  return experiment ? toInterface(experiment) : null;
}

export async function getExperimentsByIds(
  organization: string,
  ids: string[]
): Promise<ExperimentInterface[]> {
  if (!ids.length) return [];
  return await findExperiments({
    id: { $in: ids },
    organization,
  });
}

export async function getExperimentsByTrackingKeys(
  organization: string,
  trackingKeys: string[]
): Promise<ExperimentInterface[]> {
  return await findExperiments({
    trackingKey: { $in: trackingKeys },
    organization,
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
  organization,
  user,
  readAccessFilter,
}: {
  data: Partial<ExperimentInterface>;
  organization: OrganizationInterface;
  user: EventAuditUser;
  readAccessFilter: ReadAccessFilter;
}): Promise<ExperimentInterface> {
  data.organization = organization.id;

  if (!data.trackingKey) {
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
    organization,
    experiment: exp,
    user,
    readAccessFilter,
  });

  if (data.tags) {
    await addTags(data.organization, data.tags);
  }

  return toInterface(exp);
}

export async function updateExperiment({
  organization,
  experiment,
  user,
  changes,
  readAccessFilter,
  bypassWebhooks = false,
}: {
  organization: OrganizationInterface;
  experiment: ExperimentInterface;
  user: EventAuditUser;
  changes: Changeset;
  readAccessFilter: ReadAccessFilter;
  bypassWebhooks?: boolean;
}): Promise<ExperimentInterface | null> {
  await ExperimentModel.updateOne(
    {
      id: experiment.id,
      organization: organization.id,
    },
    {
      $set: changes,
    }
  );

  const updated = { ...experiment, ...changes };

  await onExperimentUpdate({
    organization,
    oldExperiment: experiment,
    newExperiment: updated,
    readAccessFilter,
    user,
    bypassWebhooks,
  });

  return updated;
}

export async function getExperimentsByMetric(
  organization: string,
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
      organization,
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
      organization,
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
      organization,
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

export async function getExperimentByIdea(
  organization: string,
  idea: IdeaDocument
): Promise<ExperimentInterface | null> {
  const experiment = await ExperimentModel.findOne({
    organization,
    ideaSource: idea.id,
  });

  return experiment ? toInterface(experiment) : null;
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
  organization: string,
  datasource: string
): Promise<Pick<ExperimentInterface, "id" | "trackingKey">[]> {
  const experiments = await ExperimentModel.find(
    {
      organization,
      datasource,
    },
    {
      _id: false,
      id: true,
      trackingKey: true,
    }
  );

  return experiments.map((exp) => ({
    id: exp.id,
    trackingKey: exp.trackingKey,
  }));
}

export async function getRecentExperimentsUsingMetric(
  organization: string,
  metricId: string
): Promise<
  Pick<
    ExperimentInterface,
    "id" | "name" | "status" | "phases" | "results" | "analysis"
  >[]
> {
  const experiments = await findExperiments(
    {
      organization: organization,
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
  organization: OrganizationInterface,
  user: EventAuditUser,
  segment: string,
  readAccessFilter: ReadAccessFilter
): Promise<void> {
  const exps = await getExperimentsUsingSegment(segment, organization.id);

  if (!exps.length) return;

  await ExperimentModel.updateMany(
    { organization: organization.id, segment },
    {
      $set: { segment: "" },
    }
  );

  exps.forEach((previous) => {
    const current = cloneDeep(previous);
    current.segment = "";

    onExperimentUpdate({
      organization,
      oldExperiment: previous,
      newExperiment: current,
      readAccessFilter,
      bypassWebhooks: true,
      user,
    });
  });
}

export async function getExperimentsForActivityFeed(
  org: string,
  ids: string[]
): Promise<Pick<ExperimentInterface, "id" | "name">[]> {
  const experiments = await ExperimentModel.find(
    {
      organization: org,
      id: {
        $in: ids,
      },
    },
    {
      _id: false,
      id: true,
      name: true,
    }
  );

  return experiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
  }));
}

/**
 * Finds an experiment for an organization
 * @param experimentId
 * @param organizationId
 */
export const findExperiment = async ({
  experimentId,
  organizationId,
}: FindOrganizationOptions): Promise<ExperimentInterface | null> => {
  const doc = await ExperimentModel.findOne({
    id: experimentId,
    organization: organizationId,
  });
  return doc ? toInterface(doc) : null;
};

// region Events

/**
 * @param organization
 * @param user
 * @param experiment
 * @return event.id
 */
const logExperimentCreated = async (
  organization: OrganizationInterface,
  user: EventAuditUser,
  experiment: ExperimentInterface,
  readAccessFilter: ReadAccessFilter
): Promise<string | undefined> => {
  const apiExperiment = await toExperimentApiInterface(
    organization,
    experiment,
    experiment.project //TODO: Is this another place I can just pass in the project so I can avoid having to pass in the readAccessFilter?
      ? await findProjectById(
          experiment.project,
          organization.id,
          readAccessFilter
        )
      : null
  );
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
 * @param organization
 * @param experiment
 * @return event.id
 */
const logExperimentUpdated = async ({
  organization,
  user,
  current,
  previous,
  readAccessFilter,
}: {
  organization: OrganizationInterface;
  user: EventAuditUser;
  current: ExperimentInterface;
  previous: ExperimentInterface;
  readAccessFilter: ReadAccessFilter;
}): Promise<string | undefined> => {
  const previousApiExperimentPromise = toExperimentApiInterface(
    organization,
    previous,
    previous.project //TODO: Is this another place I can just pass in the project so I can avoid having to pass in the readAccessFilter?
      ? await findProjectById(
          previous.project,
          organization.id,
          readAccessFilter
        )
      : null
  );
  const currentApiExperimentPromise = toExperimentApiInterface(
    organization,
    current,
    current.project //TODO: Is this another place I can just pass in the project so I can avoid having to pass in the readAccessFilter?
      ? await findProjectById(
          current.project,
          organization.id,
          readAccessFilter
        )
      : null
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

  const emittedEvent = await createEvent(organization.id, payload);
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
  organization: OrganizationInterface,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter
) {
  try {
    await ExperimentModel.deleteOne({
      id: experiment.id,
      organization: organization.id,
    });

    await VisualChangesetModel.deleteMany({ experiment: experiment.id });

    await onExperimentDelete(organization, user, experiment, readAccessFilter);
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
  organization,
  user,
  readAccessFilter,
}: {
  projectId: string;
  organization: OrganizationInterface;
  user: EventAuditUser;
  readAccessFilter: ReadAccessFilter;
}) {
  const experimentsToDelete = await ExperimentModel.find({
    organization: organization.id,
    project: projectId,
  });

  for (const experiment of experimentsToDelete) {
    await experiment.delete();
    VisualChangesetModel.deleteMany({ experiment: experiment.id });
    await onExperimentDelete(organization, user, experiment, readAccessFilter);
  }
}

/**
 * Removes the tag from any experiments that have it
 * and logs the experiment.updated event
 * @param organization
 * @param user
 * @param tag
 */
export const removeTagFromExperiments = async ({
  organization,
  user,
  tag,
  readAccessFilter,
}: {
  organization: OrganizationInterface;
  user: EventAuditUser;
  tag: string;
  readAccessFilter: ReadAccessFilter;
}): Promise<void> => {
  const query = { organization: organization.id, tags: tag };
  const previousExperiments = await findExperiments(query);

  await ExperimentModel.updateMany(query, {
    $pull: { tags: tag },
  });

  logAllChanges(
    organization,
    user,
    previousExperiments,
    (exp) => ({
      ...exp,
      tags: exp.tags.filter((t) => t !== tag),
    }),
    readAccessFilter
  );
};

export async function removeMetricFromExperiments(
  metricId: string,
  organization: OrganizationInterface,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter
) {
  const oldExperiments: Record<
    string,
    {
      previous: ExperimentInterface | null;
      current: ExperimentInterface | null;
    }
  > = {};

  const orgId = organization.id;

  const metricQuery = { organization: orgId, metrics: metricId };
  const guardRailsQuery = { organization: orgId, guardrails: metricId };
  const activationMetricQuery = {
    organization: orgId,
    activationMetric: metricId,
  };
  const docsToTrackChanges = await findExperiments({
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

  const updatedExperiments = await findExperiments({
    organization: organization.id,
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
        organization,
        oldExperiment: previous,
        newExperiment: current,
        readAccessFilter,
        bypassWebhooks: true,
        user,
      });
    }
  });
}

export async function removeProjectFromExperiments(
  project: string,
  organization: OrganizationInterface,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter
) {
  const query = { organization: organization.id, project };
  const previousExperiments = await findExperiments(query);

  await ExperimentModel.updateMany(query, { $set: { project: "" } });

  logAllChanges(
    organization,
    user,
    previousExperiments,
    (exp) => ({
      ...exp,
      project: "",
    }),
    readAccessFilter
  );
}

export async function addLinkedFeatureToExperiment(
  organization: OrganizationInterface,
  user: EventAuditUser,
  experimentId: string,
  featureId: string,
  readAccessFilter: ReadAccessFilter,
  experiment?: ExperimentInterface | null
) {
  if (!experiment) {
    experiment = await findExperiment({
      experimentId,
      organizationId: organization.id,
    });
  }

  if (!experiment) return;

  if (experiment.linkedFeatures?.includes(featureId)) return;

  await ExperimentModel.updateOne(
    {
      id: experimentId,
      organization: organization.id,
    },
    {
      $addToSet: {
        linkedFeatures: featureId,
      },
    }
  );

  onExperimentUpdate({
    organization,
    oldExperiment: experiment,
    newExperiment: {
      ...experiment,
      linkedFeatures: [...(experiment.linkedFeatures || []), featureId],
    },
    readAccessFilter,
    user,
  });
}

export async function removeLinkedFeatureFromExperiment(
  organization: OrganizationInterface,
  user: EventAuditUser,
  experimentId: string,
  featureId: string,
  readAccessFilter: ReadAccessFilter
) {
  const experiment = await findExperiment({
    experimentId,
    organizationId: organization.id,
  });

  if (!experiment) return;

  if (!experiment.linkedFeatures?.includes(featureId)) return;

  await ExperimentModel.updateOne(
    {
      id: experimentId,
      organization: organization.id,
    },
    {
      $pull: {
        linkedFeatures: featureId,
      },
    }
  );

  onExperimentUpdate({
    organization,
    oldExperiment: experiment,
    newExperiment: {
      ...experiment,
      linkedFeatures: (experiment.linkedFeatures || []).filter(
        (f) => f !== featureId
      ),
    },
    readAccessFilter,
    user,
  });
}

function logAllChanges(
  organization: OrganizationInterface,
  user: EventAuditUser,
  previousExperiments: ExperimentInterface[],
  applyChanges: (exp: ExperimentInterface) => ExperimentInterface | null,
  readAccessFilter: ReadAccessFilter
) {
  previousExperiments.forEach((previous) => {
    const current = applyChanges(cloneDeep(previous));
    if (!current) return;
    onExperimentUpdate({
      organization,
      oldExperiment: previous,
      newExperiment: current,
      readAccessFilter,
      user,
    });
  });
}

export async function getExperimentsUsingSegment(id: string, orgId: string) {
  return await findExperiments({
    organization: orgId,
    segment: id,
  });
}

/**
 * @param organization
 * @param user
 * @param experiment
 * @return experiment
 */
export const logExperimentDeleted = async (
  organization: OrganizationInterface,
  user: EventAuditUser,
  experiment: ExperimentInterface,
  readAccessFilter: ReadAccessFilter
): Promise<string | undefined> => {
  const apiExperiment = await toExperimentApiInterface(
    organization,
    experiment,
    experiment.project //TODO: Is this another place I can just pass in the project so I can avoid having to pass in the readAccessFilter?
      ? await findProjectById(
          experiment.project,
          organization.id,
          readAccessFilter
        )
      : null
  );
  const payload: ExperimentDeletedNotificationEvent = {
    object: "experiment",
    event: "experiment.deleted",
    user,
    data: {
      previous: apiExperiment,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
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
  organization: string,
  featureId: string
): Promise<Map<string, ExperimentInterface>> {
  const experiments = await findExperiments({
    organization,
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
  organization: string,
  project?: string
): Promise<Map<string, ExperimentInterface>> {
  const experiments = await findExperiments({
    organization,
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
  organization: string,
  experimentMap: Map<string, ExperimentInterface>
): Promise<Array<VisualExperiment>> => {
  const visualChangesets = await findVisualChangesets(organization);

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
  organization: OrganizationInterface,
  projects: string[]
) {
  const uniqueProjects = new Set(projects);

  const environments = getEnvironmentIdsFromOrg(organization);

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
  organization: OrganizationInterface,
  experiment: ExperimentInterface,
  linkedFeatures?: FeatureInterface[]
): SDKPayloadKey[] => {
  // If experiment is not included in the SDK payload
  if (!includeExperimentInPayload(experiment, linkedFeatures)) {
    return [];
  }

  const environments: string[] = getEnvironmentIdsFromOrg(organization);
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
  organization,
  experiment,
  user,
  readAccessFilter,
}: {
  organization: OrganizationInterface;
  experiment: ExperimentInterface;
  user: EventAuditUser;
  readAccessFilter: ReadAccessFilter;
}) => {
  await logExperimentCreated(organization, user, experiment, readAccessFilter);
};

const onExperimentUpdate = async ({
  organization,
  oldExperiment,
  newExperiment,
  readAccessFilter,
  bypassWebhooks = false,
  user,
}: {
  organization: OrganizationInterface;
  oldExperiment: ExperimentInterface;
  newExperiment: ExperimentInterface;
  readAccessFilter: ReadAccessFilter;
  bypassWebhooks?: boolean;
  user: EventAuditUser;
}) => {
  await logExperimentUpdated({
    organization,
    current: newExperiment,
    previous: oldExperiment,
    user,
    readAccessFilter,
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
      linkedFeatures = await getFeaturesByIds(organization.id, [...featureIds]);
    }

    const oldPayloadKeys = oldExperiment
      ? getPayloadKeys(organization, oldExperiment, linkedFeatures)
      : [];
    const newPayloadKeys = getPayloadKeys(
      organization,
      newExperiment,
      linkedFeatures
    );
    const payloadKeys = uniqWith(
      [...oldPayloadKeys, ...newPayloadKeys],
      isEqual
    );

    refreshSDKPayloadCache(organization, payloadKeys);
  }
};

const onExperimentDelete = async (
  organization: OrganizationInterface,
  user: EventAuditUser,
  experiment: ExperimentInterface,
  readAccessFilter: ReadAccessFilter
) => {
  await logExperimentDeleted(organization, user, experiment, readAccessFilter);

  const featureIds = [...(experiment.linkedFeatures || [])];
  let linkedFeatures: FeatureInterface[] = [];
  if (featureIds.length > 0) {
    linkedFeatures = await getFeaturesByIds(organization.id, featureIds);
  }

  const payloadKeys = getPayloadKeys(organization, experiment, linkedFeatures);
  refreshSDKPayloadCache(organization, payloadKeys);
};
