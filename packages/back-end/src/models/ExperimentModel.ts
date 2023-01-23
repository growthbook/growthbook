import omit from "lodash/omit";
import uniqBy from "lodash/uniqBy";
import mongoose, { FilterQuery, UpdateQuery } from "mongoose";
import uniqid from "uniqid";
import { ChangeLog, ExperimentInterface } from "../../types/experiment";
import { OrganizationInterface } from "../../types/organization";
import {
  determineNextDate,
  generateTrackingKey,
} from "../services/experiments";
import { IdeaDocument } from "./IdeasModel";
import { addTags } from "./TagModel";

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

export async function getExperimentById(
  id: string
): Promise<ExperimentInterface | null> {
  const experiment = await ExperimentModel.findOne({
    id,
  });
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

  return (await ExperimentModel.find(query)).map((m) => toInterface(m));
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
  ids: string[]
): Promise<ExperimentInterface[]> {
  const experiments = await ExperimentModel.find({
    id: { $in: ids },
  });

  return experiments.map((m) => toInterface(m));
}

export async function deleteExperimentById(id: string): Promise<void> {
  await ExperimentModel.deleteOne({
    id,
  });
}

export async function getExperimentsUsingSegment(
  id: string,
  orgId: string
): Promise<ExperimentInterface[]> {
  const experiments = await ExperimentModel.find(
    {
      organization: orgId,
      segment: id,
    },
    { id: 1, name: 1 }
  );

  return experiments.map((m) => toInterface(m));
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
  if (!data.organization) {
    throw new Error("Missing organization");
  }
  if (data.organization !== organization.id) {
    throw new Error("Experiment and Organization must match");
  }

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

  return toInterface(exp);
}

export async function updateExperimentById(
  experiment: ExperimentInterface,
  changes: ChangeLog
): Promise<void> {
  await ExperimentModel.updateOne(
    {
      id: experiment.id,
      organization: experiment.organization,
    },
    {
      $set: changes,
    }
  );
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
): Promise<void> {
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

export async function removeProjectFromExperiments(
  project: string,
  organization: string
): Promise<void> {
  await ExperimentModel.updateMany(
    { organization, project },
    { $set: { project: "" } }
  );
}

export async function getExperimentByIdea(
  idea: IdeaDocument
): Promise<ExperimentInterface | null> {
  const experiment = await ExperimentModel.findOne({
    organization: idea.organization,
    ideaSource: idea.id,
  });

  return experiment ? toInterface(experiment) : null;
}

export async function getExperimentsByQuery(
  query: FilterQuery<ExperimentDocument>,
  projections: { [key: string]: boolean },
  limit?: number,
  sortByField?: string,
  sortAscending?: boolean
): Promise<ExperimentInterface[]> {
  // If a sortByField is specified, add sort method, otherwise run query without
  if (sortByField) {
    const experiments = await ExperimentModel.find(query, projections)
      .limit(limit || 0)
      .sort({
        sortByField: sortAscending ? 1 : -1,
      });

    return experiments.map((m) => toInterface(m));
  } else {
    const experiments = await ExperimentModel.find(query, projections).limit(
      limit || 0
    );
    return experiments.map((m) => toInterface(m));
  }
}

export async function updateExperimentByQuery(
  query: FilterQuery<ExperimentDocument>,
  updates: UpdateQuery<ExperimentInterface>
): Promise<void> {
  await ExperimentModel.updateMany(query, updates);
}
