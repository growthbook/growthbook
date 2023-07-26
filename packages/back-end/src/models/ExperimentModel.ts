import { each, isEqual, omit, pick, uniqBy, uniqWith } from "lodash";
import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import cloneDeep from "lodash/cloneDeep";
import uniq from "lodash/uniq";
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
import { IdeaDocument } from "./IdeasModel";
import { addTags } from "./TagModel";
import { createEvent } from "./EventModel";
import {
  findVisualChangesets,
  VisualChangesetModel,
} from "./VisualChangesetModel";

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
  sequentialTestingEnabled: Boolean,
  sequentialTestingTuningParameter: Number,
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
  return await findExperiments({
    id: { $in: ids },
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
}: {
  data: Partial<ExperimentInterface>;
  organization: OrganizationInterface;
  user: EventAuditUser;
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
  bypassWebhooks = false,
}: {
  organization: OrganizationInterface;
  experiment: ExperimentInterface;
  user: EventAuditUser;
  changes: Changeset;
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
  segment: string
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
  experiment: ExperimentInterface
): Promise<string | undefined> => {
  const apiExperiment = await toExperimentApiInterface(
    organization,
    experiment
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
}: {
  organization: OrganizationInterface;
  user: EventAuditUser;
  current: ExperimentInterface;
  previous: ExperimentInterface;
}): Promise<string | undefined> => {
  const previousApiExperimentPromise = toExperimentApiInterface(
    organization,
    previous
  );
  const currentApiExperimentPromise = toExperimentApiInterface(
    organization,
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
  user: EventAuditUser
) {
  try {
    await ExperimentModel.deleteOne({
      id: experiment.id,
      organization: organization.id,
    });

    VisualChangesetModel.deleteMany({ experiment: experiment.id });

    await onExperimentDelete(organization, user, experiment);
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
}: {
  projectId: string;
  organization: OrganizationInterface;
  user: EventAuditUser;
}) {
  const experimentsToDelete = await ExperimentModel.find({
    organization: organization.id,
    project: projectId,
  });

  for (const experiment of experimentsToDelete) {
    await experiment.delete();
    VisualChangesetModel.deleteMany({ experiment: experiment.id });
    await onExperimentDelete(organization, user, experiment);
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
}: {
  organization: OrganizationInterface;
  user: EventAuditUser;
  tag: string;
}): Promise<void> => {
  const query = { organization: organization.id, tags: tag };
  const previousExperiments = await findExperiments(query);

  await ExperimentModel.updateMany(query, {
    $pull: { tags: tag },
  });

  previousExperiments.forEach((previous) => {
    const current = cloneDeep(previous);
    current.tags = current.tags.filter((t) => t != tag);

    onExperimentUpdate({
      organization,
      oldExperiment: previous,
      newExperiment: current,
      bypassWebhooks: true,
      user,
    });
  });
};

export async function removeMetricFromExperiments(
  metricId: string,
  organization: OrganizationInterface,
  user: EventAuditUser
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
        bypassWebhooks: true,
        user,
      });
    }
  });
}

export async function removeProjectFromExperiments(
  project: string,
  organization: OrganizationInterface,
  user: EventAuditUser
) {
  const query = { organization: organization.id, project };
  const previousExperiments = await findExperiments(query);

  await ExperimentModel.updateMany(query, { $set: { project: "" } });

  previousExperiments.forEach((previous) => {
    const current = cloneDeep(previous);
    current.project = "";

    onExperimentUpdate({
      organization,
      oldExperiment: previous,
      newExperiment: current,
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
  experiment: ExperimentInterface
): Promise<string | undefined> => {
  const apiExperiment = await toExperimentApiInterface(
    organization,
    experiment
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

export const getAllVisualExperiments = async (
  organization: string,
  project?: string
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

  const experiments = (
    await findExperiments({
      id: {
        $in: uniq(visualChangesets.map((changeset) => changeset.experiment)),
      },
      ...(project ? { project } : {}),
      organization,
      archived: false,
    })
  )
    // exclude experiments that are stopped and don't have a released variation
    // exclude experiments that are stopped and the released variation doesn’t have any visual changes
    .filter((e) => {
      if (e.status !== "stopped") return true;
      if (!e.releasedVariationId) return false;
      if (e.excludeFromPayload) return false;
      return visualChangesByExperimentId[e.id].some(
        (vc) =>
          vc.variation === e.releasedVariationId &&
          (!!vc.css || !!vc.domMutations.length)
      );
    });

  const visualExperiments: Array<VisualExperiment> = visualChangesets
    .map((c) => ({
      experiment: experiments.find((e) => e.id === c.experiment),
      visualChangeset: c,
    }))
    .filter(_isValidVisualExperiment);

  return visualExperiments;
};

export const getPayloadKeys = (
  organization: OrganizationInterface,
  experiment: ExperimentInterface
): SDKPayloadKey[] => {
  const environments =
    organization.settings?.environments?.map((e) => e.id) ?? [];
  const project = experiment.project ?? "";
  return environments.map((e) => ({
    environment: e,
    project,
  }));
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
  // We don't need to refresh the payload for experiments without visual changesets
  if (!newExperiment.hasVisualChangesets) return false;

  const oldChanges = getExperimentChanges(oldExperiment);
  const newChanges = getExperimentChanges(newExperiment);

  return !isEqual(oldChanges, newChanges);
};

const onExperimentCreate = async ({
  organization,
  experiment,
  user,
}: {
  organization: OrganizationInterface;
  experiment: ExperimentInterface;
  user: EventAuditUser;
}) => {
  await logExperimentCreated(organization, user, experiment);
};

const onExperimentUpdate = async ({
  organization,
  oldExperiment,
  newExperiment,
  bypassWebhooks = false,
  user,
}: {
  organization: OrganizationInterface;
  oldExperiment: ExperimentInterface;
  newExperiment: ExperimentInterface;
  bypassWebhooks?: boolean;
  user: EventAuditUser;
}) => {
  await logExperimentUpdated({
    organization,
    current: newExperiment,
    previous: oldExperiment,
    user,
  });

  if (
    !bypassWebhooks &&
    hasChangesForSDKPayloadRefresh(oldExperiment, newExperiment)
  ) {
    const oldPayloadKeys = oldExperiment
      ? getPayloadKeys(organization, oldExperiment)
      : [];
    const newPayloadKeys = getPayloadKeys(organization, newExperiment);
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
  experiment: ExperimentInterface
) => {
  await logExperimentDeleted(organization, user, experiment);

  if (experiment.hasVisualChangesets) {
    const payloadKeys = getPayloadKeys(organization, experiment);
    refreshSDKPayloadCache(organization, payloadKeys);
  }
};
