import omit from "lodash/omit";
import uniqBy from "lodash/uniqBy";
import each from "lodash/each";
import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import cloneDeep from "lodash/cloneDeep";
import { Changeset, ExperimentInterface } from "../../types/experiment";
import { OrganizationInterface } from "../../types/organization";
import {
  determineNextDate,
  experimentUpdated,
  generateTrackingKey,
} from "../services/experiments";
import {
  ExperimentCreatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
} from "../events/base-events";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import { logger } from "../util/logger";
import { IdeaDocument } from "./IdeasModel";
import { addTags } from "./TagModel";
import { createEvent } from "./EventModel";

type FindOrganizationOptions = {
  experimentId: string;
  organizationId: string;
};

type FilterKeys = ExperimentInterface & { _id: string };

type ProjectionFilter = {
  [key in keyof Partial<FilterKeys>]: boolean;
};

type SortFilter = {
  [key in keyof Partial<FilterKeys>]: 1 | -1;
};

type OptionsFilter = {
  limit?: number;
  sort?: SortFilter;
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
    },
  ],
  guardrails: [String],
  activationMetric: String,
  segment: String,
  queryFilter: String,
  skipPartialData: Boolean,
  removeMultipleExposures: Boolean,
  attributionModel: String,
  archived: Boolean,
  status: String,
  results: String,
  analysis: String,
  winner: Number,
  currentPhase: Number,
  autoAssign: Boolean,
  implementation: String,
  previewURL: String,
  targetURLRegex: String,
  variations: [
    {
      _id: false,
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
      reason: String,
      coverage: Number,
      variationWeights: [Number],
      groups: [String],
    },
  ],
  data: String,
  lastSnapshotAttempt: Date,
  nextSnapshotAttempt: Date,
  autoSnapshots: Boolean,
  ideaSource: String,
});

type ExperimentDocument = mongoose.Document & ExperimentInterface;

const ExperimentModel = mongoose.model<ExperimentDocument>(
  "Experiment",
  experimentSchema
);

/**
 * Convert the Mongo document to an ExperimentInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: ExperimentDocument): ExperimentInterface =>
  omit(doc.toJSON(), ["__v", "_id"]);

/**
 * Wraps Mongo's find method and returns results as ExperimentInterface[] with projections
 * @param query
 */
async function findExperiments(
  query: FilterQuery<ExperimentDocument>,
  projections?: ProjectionFilter,
  limit?: number,
  sortBy?: SortFilter
): Promise<ExperimentInterface[]> {
  const options: OptionsFilter = {};

  if (limit) {
    options.limit = limit;
  }
  if (sortBy) {
    options.sort = sortBy;
  }
  const experiments = await ExperimentModel.find(query, projections, options);

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

export async function createExperiment(
  data: Partial<ExperimentInterface>,
  organization: OrganizationInterface
): Promise<ExperimentInterface> {
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

  await logExperimentCreated(organization, exp);

  if (data.tags) {
    await addTags(data.organization, data.tags);
  }

  return toInterface(exp);
}

export async function updateExperimentById(
  organization: string,
  experiment: ExperimentInterface,
  changes: Changeset
): Promise<ExperimentInterface | null> {
  await ExperimentModel.updateOne(
    {
      id: experiment.id,
      organization,
    },
    {
      $set: changes,
    }
  );

  const updated = { ...experiment, ...changes };

  await experimentUpdated(updated);

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
  const goals = await findExperiments(
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
  const guardrails = await findExperiments(
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
  const activations = await findExperiments(
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
  const experiments = await findExperiments(
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
    100,
    { nextSnapshotAttempt: 1 }
  );
  return experiments;
}

export async function getExperimentsToUpdateLegacy(
  latestDate: Date
): Promise<Pick<ExperimentInterface, "id" | "organization">[]> {
  const experiments = await findExperiments(
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
    100,
    { nextSnapshotAttempt: 1 }
  );
  return experiments;
}

export async function getPastExperimentsByDatasource(
  organization: string,
  datasource: string
): Promise<Pick<ExperimentInterface, "id" | "trackingKey">[]> {
  const experiments = await findExperiments(
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

  return experiments;
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
    {
      _id: false,
      id: true,
      name: true,
      status: true,
      phases: true,
      results: true,
      analysis: true,
    },
    10,
    { _id: -1 }
  );
  return experiments;
}

export async function deleteExperimentSegment(
  organization: string,
  segment: string
): Promise<void> {
  await ExperimentModel.updateOne(
    { organization, segment },
    {
      $set: { segment: "" },
    }
  );
}

export async function getExperimentsForActivityFeed(
  org: string,
  ids: string[]
): Promise<Pick<ExperimentInterface, "id" | "name">[]> {
  const experiments = await findExperiments(
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

  return experiments;
}

export async function removeTagFromExperiment(
  organization: string,
  tagId: string
): Promise<void> {
  await ExperimentModel.updateOne(
    {
      organization,
      tags: tagId,
    },
    {
      $pull: {
        tags: tagId,
      },
    }
  );
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
 * @param experiment
 * @return event.id
 */
export const logExperimentCreated = async (
  organization: OrganizationInterface,
  experiment: ExperimentInterface
): Promise<string> => {
  const payload: ExperimentCreatedNotificationEvent = {
    object: "experiment",
    event: "experiment.created",
    data: {
      current: experiment,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  new EventNotifier(emittedEvent.id).perform();

  return emittedEvent.id;
};

/**
 * @param organization
 * @param experiment
 * @return event.id
 */
export const logExperimentUpdated = async ({
  organization,
  current,
  previous,
}: {
  organization: OrganizationInterface;
  current: ExperimentInterface;
  previous: ExperimentInterface;
}): Promise<string> => {
  const payload: ExperimentUpdatedNotificationEvent = {
    object: "experiment",
    event: "experiment.updated",
    data: {
      previous,
      current,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  new EventNotifier(emittedEvent.id).perform();

  return emittedEvent.id;
};

/**
 * Deletes an experiment by ID and logs the event for the organization
 * @param id
 * @param organization
 */
export async function deleteExperimentByIdForOrganization(
  experiment: ExperimentInterface,
  organization: OrganizationInterface
) {
  try {
    await logExperimentDeleted(organization, experiment);

    await ExperimentModel.deleteOne({
      id: experiment.id,
      organization: organization.id,
    });
  } catch (e) {
    logger.error(e);
  }
}

/**
 * Removes the tag from any experiments that have it
 * and logs the experiment.updated event
 * @param organization
 * @param tag
 */
export const removeTagFromExperiments = async ({
  organization,
  tag,
}: {
  organization: OrganizationInterface;
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

    logExperimentUpdated({
      organization,
      previous,
      current,
    });
  });
};

export async function removeMetricFromExperiments(
  metricId: string,
  organization: OrganizationInterface
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

  const updatedExperimentsInterface = updatedExperiments.map(toInterface);

  // Populate updated experiments
  updatedExperimentsInterface.forEach((experiment) => {
    const changeSet = oldExperiments[experiment.id];
    if (changeSet) {
      changeSet.current = experiment;
    }
  });

  // Log all the changes
  each(oldExperiments, async (changeSet) => {
    const { previous, current } = changeSet;
    if (current && previous) {
      await logExperimentUpdated({
        organization,
        current,
        previous,
      });
    }
  });
}

export async function removeProjectFromExperiments(
  project: string,
  organization: OrganizationInterface
) {
  const query = { organization: organization.id, project };
  const previousExperiments = await findExperiments(query);

  await ExperimentModel.updateMany(query, { $set: { project: "" } });

  previousExperiments.forEach((previous) => {
    const current = cloneDeep(previous);
    current.project = "";

    logExperimentUpdated({
      organization,
      previous,
      current,
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
 * @param experiment
 * @return event.id
 */
export const logExperimentDeleted = async (
  organization: OrganizationInterface,
  experiment: ExperimentInterface
): Promise<string> => {
  const payload: ExperimentDeletedNotificationEvent = {
    object: "experiment",
    event: "experiment.deleted",
    data: {
      previous: experiment,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  new EventNotifier(emittedEvent.id).perform();

  return emittedEvent.id;
};

// endregion Events
